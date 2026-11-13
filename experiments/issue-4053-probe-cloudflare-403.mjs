/**
 * Issue #4053, local-only upstream probe: how does Claude Code report a Cloudflare challenge page?
 *
 *   node experiments/issue-4053-probe-cloudflare-403.mjs [challenge|plain] [--save events.jsonl]
 *
 * A local server answers every request with HTTP 403, `content-type: text/html`,
 * `<title>Attention Required! | Cloudflare</title>` and (mode "challenge") the
 * `cf-mitigated: challenge` header Cloudflare documents for challenge pages.
 * Uses a dummy API key, a temporary config directory, no tools, at most 10 HTTP
 * requests, 512 KiB of captured output and a 60-second process bound.
 * Prints the request count and the terminal `result` event.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mode = process.argv[2] || 'challenge';
const saveIndex = process.argv.indexOf('--save');
const savePath = saveIndex > 0 ? process.argv[saveIndex + 1] : null;
const root = await mkdtemp(path.join(os.tmpdir(), 'claude-cf403-probe-'));
const config = path.join(root, 'config');
await mkdir(config);
const html = '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><p>Cloudflare Ray ID: 0000000000000000</p></body></html>';
const requests = [];
let child = null;
const stop = () => child?.kill('SIGKILL');
const server = http.createServer((req, res) => {
  req.resume();
  if (requests.length >= 10) return void (req.destroy(), stop());
  requests.push({ method: req.method, url: req.url, at: new Date().toISOString() });
  res.writeHead(403, { 'content-type': 'text/html; charset=UTF-8', server: 'cloudflare', 'cf-ray': '0000000000000000-AMS', ...(mode === 'challenge' ? { 'cf-mitigated': 'challenge' } : {}) });
  res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
child = spawn(process.env.CLAUDE_PROBE_BIN || 'claude', ['-p', 'say hi', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--tools', '', '--setting-sources', '', '--strict-mcp-config'], {
  cwd: root,
  env: { PATH: process.env.PATH, LANG: 'C.UTF-8', CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'mock-not-a-real-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
const timer = setTimeout(stop, 60000);
child.stdout.on('data', chunk => {
  if (stdout.length < 512 * 1024) stdout += chunk;
});
child.stderr.resume();
const exitCode = await new Promise(resolve => child.on('close', resolve));
clearTimeout(timer);
server.close();
await rm(root, { recursive: true, force: true });
const events = stdout
  .split('\n')
  .filter(Boolean)
  .map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
if (savePath) await writeFile(savePath, stdout);
const result = events.find(event => event.type === 'result');
const pick = event => event && { is_error: event.is_error, subtype: event.subtype, error: event.error, api_error_status: event.api_error_status, result: event.result };
console.log(JSON.stringify({ mode, exitCode, requests: requests.length, result: pick(result), apiErrors: events.filter(e => e.type === 'assistant' && e.error).map(e => ({ error: e.error, text: e.message?.content?.[0]?.text })) }, null, 2));
