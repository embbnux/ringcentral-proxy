const tokenRefreshPromise = {};
// Check if user authorized, refresh token if need
async function checkAuthBeforeRequest(rcSDK, req) {
  let token = req.session.token;
  if (!token || !rcSDK.isRefreshTokenValid(token)) {
    return { authorized: false };
  }
  let authorized = true;
  if (!rcSDK.isAccessTokenValid(token)) {
    let needToUpdateSession = false;
    // handle refresh token concurrence issue, TODO: should save token in DB to avoid concurrence issue
    if (!tokenRefreshPromise[token.refresh_token]) {
      needToUpdateSession = true;
      tokenRefreshPromise[token.refresh_token] = rcSDK.refreshToken(token)
    }
    try {
      token = await tokenRefreshPromise[token.refresh_token];
    } catch (e) {
      console.error(e);
      authorized = false
    }
    delete tokenRefreshPromise[token.refresh_token];
    if (needToUpdateSession) {
      if (authorized) {
        req.session.token = token;
      } else {
        req.session.token = null;
      }
    }
  }
  return { authorized, token }
}

// Change if need tp replace media uri to proxy
const shouldHandleMediaLink = (path) => {
  return (
    path.indexOf('call-log') > -1 ||
    path.indexOf('message-store') > -1 ||
    path.indexOf('message-sync') > -1 ||
    path.indexOf('meeting') > -1
  );
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

// Replace media.ringcentral.com in response text to media proxy endpoint
const handleMediaLink = (text, rcServer) => {
  // const rcServer = ringcentralOptions.server;
  const mediaServer = rcServer.replace('platform', 'media');
  return text.split(mediaServer).join(`${process.env.SERVER}/proxy/media`);
};

exports.checkAuthBeforeRequest = checkAuthBeforeRequest;
exports.shouldHandleMediaLink = shouldHandleMediaLink;
exports.formatHeaders = formatHeaders;
exports.handleMediaLink = handleMediaLink;
