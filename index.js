const cors = require('cors');
const http = require('http');
const request = require('request');
const { RingCentral } = require('./lib/ringcentral');
const cookieSession = require('cookie-session')
const express = require('express');

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

// Check if user authorized, refresh token if need
async function checkAuthBeforeRequest(rcSDK, req) {
  let token = req.session.token;
  if (!token || !rcSDK.isRefreshTokenValid(token)) {
    return { authorized: false };
  }
  if (!rcSDK.isAccessTokenValid(token)) {
    token = await rcSDK.refreshToken(token);
    req.session.token = token;
  }
  return { authorized: true, token }
}

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

// Change if need tp replace media uri to proxy
const shouldHandleMediaLink = (path) => {
  return (
    path.indexOf('call-log') > -1 ||
    path.indexOf('message-store') > -1 ||
    path.indexOf('message-sync') > -1 ||
    path.indexOf('meeting') > -1
  );
};

// Replace media.ringcentral.com in response text to media proxy endpoint
const handleMediaLink = (text) => {
  const rcServer = ringcentralOptions.server;
  const mediaServer = rcServer.replace('platform', 'media');
  return text.split(mediaServer).join(`${process.env.SERVER}/proxy/media`);
};

// Format Header key, eg: "accept-encoding" to "Accept-Encoding"
function formatHeaderKey(key) {
  if (key === 'rcrequestid') {
    return 'RCRequestId';
  }
  return key.split('-').map((word) => {
    return word.charAt(0).toUpperCase() + word.slice(1)
  }).join('-');
}

// Format Header keys
const formatHeaders = (rawHeaders) => {
  delete rawHeaders['content-length'];
  delete rawHeaders['connection'];
  delete rawHeaders['content-encoding'];
  const headers = {};
  Object.keys(rawHeaders).forEach((key) => {
    headers[formatHeaderKey(key)] = rawHeaders[key].join(',')
  });
  return headers;
}

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
    body = handleMediaLink(body);
  } else {
    body = await response.buffer();
  }
  const headers = formatHeaders(response.headers.raw());
  res.set(headers);
  res.status(response.status);
  res.send(body);
});
