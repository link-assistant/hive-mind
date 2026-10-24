/**
 * Local-only upstream probe: node experiments/issue-3759/probe-claude-403.mjs [json|br]
 * Uses a dummy API key, a temporary config directory, no tools, at most 10 HTTP
 * requests, 512 KiB of captured output and a 45-second process bound.
 */
import http from 'node:http';
import { brotliCompressSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mode = process.argv[2] || 'json';
if (!['json', 'br'].includes(mode)) throw new Error('Expected json or br');
const data = new URL('../../docs/case-studies/issue-3759/data/', import.meta.url);
const root = await mkdtemp(path.join(os.tmpdir(), 'claude-403-probe-'));
const config = path.join(root, 'config');
await mkdir(config);
const requests = [];
const server = http.createServer((req, res) => {
  req.resume();
  if (requests.length >= 10) {
    req.destroy();
    stop();
    return;
  }
  requests.push({ method: req.method, url: req.url });
  const body = JSON.stringify({ type: 'error', error: { type: 'permission_error', message: 'Your subscription has ended because it was cancelled.' }, request_id: 'req_mock_3759' });
  res.writeHead(403, { 'content-type': 'application/json', 'request-id': 'req_mock_3759', 'x-should-retry': 'false', ...(mode === 'br' ? { 'content-encoding': 'br' } : {}) });
  res.end(mode === 'br' ? brotliCompressSync(body) : body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(process.env.CLAUDE_PROBE_BIN || 'claude', ['-p', 'say hi', '--output-format', 'stream-json', '--verbose', '--model', 'opus', '--tools', '', '--setting-sources', '', '--strict-mcp-config'], {
  cwd: root,
  env: {
    PATH: process.env.PATH,
    LANG: 'C.UTF-8',
    CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_API_KEY: 'mock-not-a-real-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_LOG: 'debug',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const output = { stdout: '', stderr: '' };
let bytes = 0;
let boundReached = false;
const stop = () => {
  boundReached = true;
  child.kill('SIGKILL');
};
const timer = setTimeout(stop, 45000);
for (const stream of ['stdout', 'stderr'])
  child[stream].on('data', chunk => {
    bytes += chunk.length;
    if (bytes <= 512 * 1024) output[stream] += chunk;
    else stop();
  });
try {
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  await writeFile(new URL(`probe-${mode}-stdout.log`, data), output.stdout);
  await writeFile(new URL(`probe-${mode}-stderr.log`, data), output.stderr);
  const events = output.stdout.split('\n').flatMap(line => {
    try {
      const event = JSON.parse(line);
      return [{ type: event.type, subtype: event.subtype, error: event.error, result: event.result, is_error: event.is_error }];
    } catch {
      return [];
    }
  });
  const summary = { mode, ...result, boundReached, bytes, requests, events, nonJsonLines: output.stdout.split('\n').filter(line => line && !line.startsWith('{')).length };
  await writeFile(new URL(`probe-${mode}-summary.json`, data), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  clearTimeout(timer);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
