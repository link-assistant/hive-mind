A local reproduction, plus a suggested fix, from an automation tool that runs Claude Code headless (`claude -p --output-format stream-json`).

### What happens

During the 2026-11-13 incident on status.claude.com ("We are investigating an issue with users authenticating to Claude.ai and Claude Code", 09:58 UTC), the CLI ended a headless run with:

```json
{"type":"assistant","error":"authentication_failed","message":{"content":[{"type":"text","text":"Failed to authenticate. API Error: 403 Attention Required! | Cloudflare"}]}}
{"type":"result","subtype":"success","is_error":true,"api_error_status":403,"result":"Failed to authenticate. API Error: 403 Attention Required! | Cloudflare"}
```

A minute later `claude -p hi` worked with the same stored credentials, without a re-login. The 403 came from Cloudflare's edge (an HTML challenge/block page), not from the API's auth layer. The CLI still reported it as `authentication_failed` and "Please run /login". Wrappers, and people, then treat a temporary edge block as an expired login.

### Reproduction (no real credentials, about 5 seconds)

A local server returns what Cloudflare returns: HTTP 403, `content-type: text/html`, `<title>Attention Required! | Cloudflare</title>`, and optionally the documented [`cf-mitigated: challenge`](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) header:

```js
// cf403.mjs — node cf403.mjs, then in another shell:
//   ANTHROPIC_API_KEY=dummy ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude -p hi --output-format stream-json --verbose
import http from 'node:http';
http
  .createServer((req, res) => {
    req.resume();
    res.writeHead(403, { 'content-type': 'text/html; charset=UTF-8', server: 'cloudflare', 'cf-mitigated': 'challenge' });
    res.end('<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>');
  })
  .listen(8787, '127.0.0.1');
```

With Claude Code 2.1.323 the server sees **one** request (no retry), and the stream ends with `"error":"authentication_failed"`, `api_error_status: 403` and `"Failed to authenticate. API Error: 403 Attention Required! | Cloudflare"`. The result is the same with or without `cf-mitigated`.

### Workaround (for wrappers)

Treat `authentication_failed` / `permission_error` with HTTP 401/403 as _unconfirmed_ unless the message names a reason, such as "OAuth token revoked", "expired", billing, or a disabled organization. Retry it a few times with backoff and with the session resumed, and keep retrying while `https://status.claude.com/api/v2/summary.json` reports an incident. In particular, an `API Error: 403` whose title is an HTML page title (`Attention Required! | Cloudflare`, `Just a moment...`) is an edge block, not a credential problem.

### Suggested fix

1. When a 401/403 response is `text/html`, carries `cf-mitigated`, or carries `server: cloudflare` without a JSON `error` body, classify it as a network/edge error (for example `error: "edge_blocked"` or `"network_error"`), not `authentication_failed`. Say "request blocked by Cloudflare before it reached the API; this is usually temporary". Do not say "Please run /login".
2. Retry such responses with the same backoff as 5xx/overloaded errors. `cf-mitigated: challenge` is often temporary, and here the next request a minute later succeeded.
3. Optionally include the `cf-ray` ID in the error text, so users can report the block.

Related: #109508, #109516, #109517, #108761, #66844.
