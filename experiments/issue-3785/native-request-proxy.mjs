// The model-request fixture refuses all CONNECT tunnels before TLS/auth.
const origins = new Set(['github.com:443', 'api.github.com:443', 'chatgpt.com:443', 'raw.githubusercontent.com:443']);

export function refuseNativeProxyTunnel(request, socket, blockedOrigins, onInvalid) {
  // Once CONNECT is handled, this socket is outside the normal HTTP request
  // error handlers. A refused native client can reset it while being reaped.
  socket.on('error', error => {
    if (!['ECONNRESET', 'EPIPE'].includes(error.code)) onInvalid();
  });
  if (!origins.has(request.url)) onInvalid();
  blockedOrigins.add(request.url);
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
}
