// Issue #3785: capture the first Anthropic Messages request a Claude Code CLI
// sends, so a probe can see which skills/MCP tools a session really exposes
// without any account. Usage: node capture-anthropic-request.mjs <port> <out.jsonl>
// Point the CLI at it with ANTHROPIC_BASE_URL=http://127.0.0.1:<port> and a
// dummy ANTHROPIC_API_KEY; every request is answered with a non-retryable 400.
import http from 'node:http';
import fs from 'node:fs';

const [port, out] = process.argv.slice(2);
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      if (req.url.startsWith('/v1/messages') && body) fs.appendFileSync(out, `${body}\n`);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'capture probe' } }));
    });
  })
  .listen(Number(port), '127.0.0.1');
