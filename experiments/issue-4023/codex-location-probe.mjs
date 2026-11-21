// No upstream requests: capture Codex's Responses payload on loopback.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
import { buildCodexGeolocationConfigArgs } from '../../src/geolocation-policy.lib.mjs';

const home = await mkdtemp(path.join(os.tmpdir(), 'codex-location-probe-'));
const requests = [];
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url !== '/responses') {
    res.writeHead(404).end();
    return;
  }
  requests.push(JSON.parse(body));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const response = { id: 'resp_mock', object: 'response', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } };
  res.end(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await writeFile(path.join(home, 'config.toml'), ['model_provider = "mock"', 'web_search = "live"', '[model_providers.mock]', 'name = "Loopback mock"', `base_url = "http://127.0.0.1:${server.address().port}"`, 'wire_api = "responses"', '[tools.web_search]', 'allowed_domains = ["example.com"]', 'context_size = "low"', '[tools.web_search.location]', 'country = "ZZ"', 'city = "Synthetic City"', 'region = "Synthetic Region"', 'timezone = "Etc/UTC"', ''].join('\n'));
  for (const mode of ['baseline', 'private', 'opt-in']) {
    const args = ['exec', '--model', 'gpt-5.3-codex', '--json', '--skip-git-repo-check', '--ephemeral', '--dangerously-bypass-approvals-and-sandbox', '-c', 'features.remote_plugin=false'];
    if (mode !== 'baseline' && !process.argv.includes('--without-fix')) {
      args.push(...(process.argv.includes('--empty-table') && mode === 'private' ? ['-c', 'tools.web_search.location={}'] : buildCodexGeolocationConfigArgs({ shareGeolocation: mode === 'opt-in' })));
    }
    args.push('Reply OK without using tools.');
    const child = spawn(process.env.CODEX_PATH || 'codex', args, { cwd: home, env: { ...process.env, CODEX_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      output += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    assert.equal(code, 0, output.slice(-4000));
    const tool = requests.at(-1)?.tools?.find(item => item.type === 'web_search');
    assert.ok(tool, 'web search specification missing');
    console.log(JSON.stringify({ mode, tool }, null, 2));
    assert.deepEqual(tool.filters, { allowed_domains: ['example.com'] });
    if (mode !== 'private') assert.equal(tool.user_location.city, 'Synthetic City');
    else assert.deepEqual(tool.user_location, { type: 'approximate', country: '', city: '', region: '', timezone: '' });
    assert.equal(tool.search_context_size, 'low');
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(home, { recursive: true, force: true });
}
