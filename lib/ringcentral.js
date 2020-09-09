const qs = require('querystring');
const fetch = require('node-fetch');

class RingCentral {
  constructor(options) {
    this._options = options;
  }

  loginUrl() {
    const query = {
      response_type: 'code',
      redirect_uri: this._options.redirectUri,
      client_id: this._options.clientId,
    };
    return `${this._options.server}/restapi/oauth/authorize?${qs.stringify(query)}`;
  }

  async generateToken({ code }) {
    const body = {
      code,
      grant_type: 'authorization_code',
      redirect_uri: this._options.redirectUri,
    };
    const response = await this._tokenRequest('/restapi/oauth/token', body);
    return response.json();
  }

  async refreshToken(token) {
    const body = {
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      access_token_ttl: token.expires_in,
      refresh_token_ttl: token.refresh_token_expires_in,
    };
    const response = await this._tokenRequest('/restapi/oauth/token', body);
    if (Number.parseInt(response.status, 10) >= 400) {
      throw new Error('Refresh Token error', response.status);
    }
    return response.json();
  }

  async revokeToken(token) {
    const body = {
      token: token.access_token,
    };
    await this._tokenRequest('/restapi/oauth/revoke', body);
  }

  async _tokenRequest(path, body) {
    const authorization = `${this._options.clientId}:${this._options.clientSecret}`;
    const response = await fetch(
      `${this._options.server}${path}`, {
        method: 'POST',
        body: qs.stringify(body),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(authorization).toString('base64')}`
        },
      }
    );
    return response;
  }

  async request({ server = this._options.server, path, query, body, method, headers = {} }, token) {
    let uri = `${server}${path}`;
    if (query) {
      uri = uri + (uri.includes('?') ? '&' : '?') + qs.stringify(query);
    }
    const reqHeaders = {
      'Accept': headers['accept'],
      'Content-Type': headers['content-type'],
      'Client-Id': this._options.clientId,
      'User-Agent': headers['user-agent'],
      // 'X-User-Agent': headers['x-user-agent'],
      'Accept-Encoding': headers['accept-encoding'],
      'Accept-Language': headers['accept-language'],
      'Connection': headers['connection'],
    };
    if (headers['range']) {
      reqHeaders['Range'] = headers['range'];
    }
    if (headers['upgrade-insecure-requests']) {
      reqHeaders['Upgrade-Insecure-Requests'] = headers['upgrade-insecure-requests']
    }
    if (token) {
      reqHeaders['Authorization'] = `${token.token_type} ${token.access_token}`;
    }
    const response = await fetch(uri, {
      method,
      body: body ? JSON.stringify(body): body,
      headers: reqHeaders,
    });
    return response;
  }

  isRefreshTokenValid(token) {
    const expireTime = Date.now() + token.refresh_token_expires_in * 1000;
    return expireTime > Date.now();
  }

  isAccessTokenValid(token) {
    const expireTime = Date.now() + token.expires_in * 1000
    return expireTime - 60 * 1000 > Date.now();
  }
}

exports.RingCentral = RingCentral;
