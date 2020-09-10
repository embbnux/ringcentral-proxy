const cors = require('cors');
const http = require('http');
const request = require('request');
const cookieSession = require('cookie-session')
const express = require('express');
const { RingCentral } = require('./lib/ringcentral');
const {
  checkAuthBeforeRequest,
  shouldHandleMediaLink,
  formatHeaders,
  handleMediaLink,
} = require('./lib/utils');

require('dotenv').config()

const app = express();
const server = http.createServer(app);
server.listen(process.env.PORT);

// support CORS for APP_ORIGIN domain
app.use(cors({ credentials: true, origin: process.env.APP_ORIGIN }));
// cookie session config
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SERVER_SECRET_KEY],
  httpOnly: true,
  signed: true,
  sameSite: "none",
  maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
}));
app.use(express.json());

// RingCentral client config
const ringcentralOptions = {
  server: process.env.RINGCENTRAL_SERVER,
  clientId: process.env.RINGCENTRAL_CLIENT_ID,
  clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET,
  redirectUri: `${process.env.SERVER}/proxy/oauth-callback`,
};

// Handle authorize request, redirect to RingCentral OAuth url
app.get('/proxy/authorize', (req, res) => {
  req.session.redirectAfterAuth = null;
  const rcSDK = new RingCentral(ringcentralOptions);
  res.redirect(rcSDK.loginUrl());
});

// Handle RingCentral OAuth Callback request
app.get('/proxy/oauth-callback', async (req, res) => {
  let redirectUrl;
  if (req.session.redirectAfterAuth) {
    redirectUrl = req.session.redirectAfterAuth
    req.session.redirectAfterAuth = null;
  } else {
    redirectUrl = process.env.APP_AUTH_REDIRECT
  }
  if (!req.query.code) {
    res.redirect(`${redirectUrl}?error=${req.query.error}`);
    return;
  }
  const rcSDK = new RingCentral(ringcentralOptions);
  const token = await rcSDK.generateToken(req.query);
  // In this app, we save RingCentral token in user's cookie with encryption, but it is recommend to save token in DB
  req.session.token = token;
  //  After authorized, redirect to app's redirect page
  res.redirect(`${redirectUrl}?result=success`);
});

// Handle logout request
const onLogout = async (req, res) => {
  const token = req.session.token;
  req.session.token = null;
  if (token) {
    const rcSDK = new RingCentral(ringcentralOptions);
    await rcSDK.revokeToken(token);
  }
  res.json({ result: 'success' });
};
app.get('/proxy/logout', onLogout);
app.post('/proxy/logout', onLogout);

// API to validate if user authorized
app.get('/proxy/restapi/v1.0/client-info', async (req, res) => {
  const rcSDK = new RingCentral(ringcentralOptions);
  const result = await checkAuthBeforeRequest(rcSDK, req);
  if (!result.authorized) {
    res.status(401);
    res.json({ message: 'Token not found' });
    res.end();
    return;
  }
  const token = result.token;
  res.status(200);
  res.json({
    owner_id: token.owner_id,
    scope: token.scope,
    endpoint_id: token.endpoint_id,
  });
});

// Handle media request, proxy to RingCental media server
app.use('/proxy/media', async (req, res) => {
  // Don't proxy oauth token request
  if (req.path.indexOf('oauth') > -1) {
    res.status(403);
    res.end();
    return
  }
  const rcSDK = new RingCentral(ringcentralOptions);
  const result = await checkAuthBeforeRequest(rcSDK, req);
  if (!result.authorized) {
    if (req.headers['sec-fetch-mode'] === 'navigate') {
      //  when visit with browser navigate, redirect to oauth page
      req.session.redirectAfterAuth = `${process.env.SERVER}/proxy/media${req.path}`;
      res.redirect(rcSDK.loginUrl());
      return;
    }
    res.status(401);
    res.json({ message: 'Token not found' });
    res.end();
    return;
  }
  const token = result.token;
  const rcServer = ringcentralOptions.server;
  const mediaServer = rcServer.replace('platform', 'media');
  const headers = {};
  if (req.headers['range']) {
    headers['Range'] = req.headers['range'];
  }
  let remoteReq = request.get(`${mediaServer}${req.path}?access_token=${token.access_token}`, {
    headers,
  });
  req.on('close', function() {
    remoteReq.abort();
    res.end();
  });
  req.pipe(remoteReq).pipe(res);
});

// Proxy API request to RingCentral server
app.use('/proxy', async (req, res) => {
  // Don't proxy oauth token request
  if (req.path.indexOf('oauth') > -1) {
    res.status(403);
    res.end();
    return
  }
  const rcSDK = new RingCentral(ringcentralOptions);
  const result = await checkAuthBeforeRequest(rcSDK, req);
  if (!result.authorized) {
    res.status(401);
    res.json({ message: 'Token not found' });
    res.end();
    return;
  }
  const token = result.token;
  const response = await rcSDK.request({
    method: req.method,
    path: req.path,
    body: req.method !== 'GET' ? req.body : undefined,
    query: req.query,
    headers: req.headers
  }, token);
  let body;
  if (shouldHandleMediaLink(req.path)) {
    body = await response.text();
    body = handleMediaLink(body, ringcentralOptions.server);
  } else {
    body = await response.buffer();
  }
  if (response.status === 401) {
    req.session.token = null;
  }
  const headers = formatHeaders(response.headers.raw());
  res.set(headers);
  res.status(response.status);
  res.send(body);
});
