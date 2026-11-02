#!/usr/bin/env node
// Issue #3785: Codex through the lifecycle provider with synthetic ChatGPT auth.
// Usage: node probe-lifecycle-provider-codex.mjs [codex] ['<features toml>']
//
// Observed 2026-11-01 with Codex 0.166 (synthetic auth; every OpenAI/ChatGPT
// host is answered by the loopback provider, only download hosts tunnel):
// - The provider must use a separate CA and leaf: rustls rejects a self-signed
//   CA:TRUE certificate as the end-entity (CaUsedAsEndEntity).
// - Codex first tries a WebSocket upgrade on /backend-api/codex/responses (the
//   provider answers 426) and falls back to HTTPS POST; before the model call
//   it needs GET /backend-api/wham/accounts/check (workspace routing).
// - With only `remote_plugin = false` a model start clones the curated plugin
//   catalog through github.com (541 SKILL.md files in ~4-5.5 s) and requests
//   plugins/featured and ps/plugins/installed.
// - With `plugins = false` none of that happens; only the 5 stock .system
//   skills exist, the turn completes and auth.json is unchanged.
// - Independently, `features.apps` (stable, default on) adds the hosted
//   `codex_apps` MCP server: POST chatgpt.com/backend-api/ps/mcp on every
//   start. Hive Mind now pins `apps = false` outside selected plugin scopes.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startSyntheticVendorProvider } from '../../scripts/capability-lifecycle-provider.lib.mjs';

const codex = process.argv[2] || 'codex';
const features = process.argv[3] || 'remote_plugin = false';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-lp-codex-'));
const provider = await startSyntheticVendorProvider({ root: path.join(root, 'provider') });
const home = path.join(root, 'home');
await fs.mkdir(path.join(home, '.codex'), { recursive: true });
await fs.mkdir(path.join(root, 'work'));
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = `${part({ alg: 'none' })}.${part({ email: 'synthetic@example.invalid', 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_user_id: 'synthetic-user', chatgpt_plan_type: 'plus' } })}.synthetic`;
await fs.writeFile(path.join(home, '.codex/auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken, access_token: 'SYNTHETIC-ACCESS', refresh_token: 'SYNTHETIC-REFRESH', account_id: 'synthetic-account' }, last_refresh: new Date().toISOString() }), { mode: 0o600 });
await fs.writeFile(path.join(home, '.codex/config.toml'), `[features]\n${features}\n`);
const before = await fs.readFile(path.join(home, '.codex/auth.json'), 'utf8');
let release;
provider.holdModels(new Promise(resolve => (release = resolve)));
const started = Date.now();
const child = spawn(codex, ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', 'echo hi'], { cwd: path.join(root, 'work'), env: { HOME: home, PATH: process.env.PATH, TERM: 'dumb', ...provider.env }, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
child.stdout.on('data', chunk => (stdout += chunk));
let stderr = '';
child.stderr.on('data', chunk => (stderr += chunk).length > 20000 && (stderr = stderr.slice(-20000)));
const closed = new Promise(resolve => child.once('close', code => resolve(code)));
let appeared = null;
for (let i = 0; i < 120 && appeared === null; i++) {
  await new Promise(resolve => setTimeout(resolve, 500));
  if (await fs.stat(path.join(home, '.codex/.tmp/plugins')).catch(() => null)) appeared = Date.now() - started;
}
await new Promise(resolve => setTimeout(resolve, 3000));
release();
const code = await Promise.race([closed, new Promise(resolve => setTimeout(() => resolve('timeout'), 60000))]);
if (code === 'timeout') child.kill('SIGKILL');
const { stdout: skills } = await import('node:child_process').then(({ execFileSync }) => ({
  stdout: execFileSync('bash', ['-c', `find "${home}" -name SKILL.md | wc -l`])
    .toString()
    .trim(),
}));
console.log(`exit=${code} curated appeared after ${appeared ?? 'never'} ms; SKILL.md=${skills}`);
console.log('auth unchanged:', before === (await fs.readFile(path.join(home, '.codex/auth.json'), 'utf8')));
console.log('requests:', [...new Set(provider.requests)].sort().join(' | '));
console.log('tunnels:', [...provider.tunnels].join(','), 'refused:', [...provider.refused].join(','));
console.log(
  'events:',
  stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        const event = JSON.parse(line);
        return event.type + (event.item?.type ? `:${event.item.type}` : '') + (event.message ? `:${String(event.message).slice(0, 200)}` : '') + (event.error?.message ? `:${event.error.message.slice(0, 200)}` : '');
      } catch {
        return line.slice(0, 100);
      }
    })
    .join(' | ')
);
console.log(
  'stderr tail:\n' +
    stderr
      .split('\n')
      .filter(Boolean)
      .slice(-12)
      .map(line => line.slice(0, 400))
      .join('\n')
);
await provider.close();
await fs.rm(root, { recursive: true, force: true });
