# RingCentral Proxy

[Experiment] A lite node.js app to show how to authorize RingCentral in server side. Use cookie to authorize with client side, and proxy client-side request to RingCentral API request.

[Online Demo](https://github.com/embbnux/ringcentral-proxy-demo/) with RingCentral Embeddable

## Development

### Clone this project:

```bash
$ git clone https://github.com/embbnux/ringcentral-proxy.git
```

### Create a free RingCentral app

1. Create a [RingCentral developer free account](https://developer.ringcentral.com)
2. Create a RingCentral app with platform type - "Web Server"
3. Add permissions `Edit Message`, `Edit Presence`, `Internal Messages`, `Read Accounts`, `Read Call Log`, `Read Contacts`, `Read Messages`, `Read Presence`, `RingOut`, `SMS`, `VoIP Calling` and `Call Control` to your app.
4. Add redirect uri `https://your_server_domain/proxy/oauth-callback` to your app settings.

### Create environment variables file in project root path

Create `.env` file in project root path:

```
PORT=3000
SERVER=http://localhost:3000
SERVER_SECRET_KEY=server_secret_key_for_cookie_session
RINGCENTRAL_CLIENT_ID=your_ringcentral_client_id
RINGCENTRAL_CLIENT_SECRET=your_ringcentral_client_secret
RINGCENTRAL_SERVER=https://platform.devtest.ringcentral.com
APP_ORIGIN=http://ringcentral.github.io
APP_AUTH_REDIRECT=http://ringcentral.github.io/ringcentral-embeddable/redirect.html
```

### Start server

We assume you have pre-installed node.js > 8 and yarn.

```bash
$ yarn       # use yarn to install dependences
$ yarn start # start a webpack dev server
```

### Test with RingCentral Embeddable

Add Embeddable with following script into website:

```html
<script>
  (function() {
    var rcs = document.createElement("script");
    rcs.src = "https://ringcentral.github.io/ringcentral-embeddable/adapter.js?appServer=https://your_server_domain/proxy&authProxy=1";
    var rcs0 = document.getElementsByTagName("script")[0];
    rcs0.parentNode.insertBefore(rcs, rcs0);
  })();
</script>
```
