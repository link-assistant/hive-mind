/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

test('all stock-gate native children receive disposable homes without inherited credentials or overrides', { timeout: 10000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-gate-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'global-home');
  const capture = path.join(root, 'children.jsonl');
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\n');
  await mkdir(path.join(home, '.claude'));
  await writeFile(path.join(home, '.claude/settings.json'), JSON.stringify({ syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } }));
  const code = `#!${process.execPath}
import fs from 'node:fs';
import readline from 'node:readline';
const version = process.argv.includes('--version');
const claude = process.argv[1].endsWith('claude.mjs');
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({
  mode: version ? (claude ? 'claude-version' : 'codex-version') : 'stock',
  inherited: Object.hasOwn(process.env, 'HIVE_MIND_GATE_ENV_SENTINEL'),
  privateHome: (process.env.HOME || '').startsWith(${JSON.stringify(path.join(os.tmpdir(), 'hive-stock-gate-'))}),
}) + '\\n');
if (version) { console.log(claude ? '2.1.310 (Claude Code)' : 'codex-cli 0.164.0'); process.exit(0); }
readline.createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.id) console.log(JSON.stringify({id: message.id, result: message.method === 'skills/list' ? {data: [{}]} : {}}));
});
`;
  const claude = path.join(root, 'claude.mjs');
  const codex = path.join(root, 'codex.mjs');
  for (const file of [claude, codex]) await writeFile(file, code, { mode: 0o700 });
  const module = new URL('../src/verify-agent-runtime.mjs', import.meta.url).href;
  const invoke = `import assert from 'node:assert/strict'; import {verifyAgentRuntime} from ${JSON.stringify(module)}; await assert.rejects(verifyAgentRuntime(${JSON.stringify({ homeDir: home, claudeCommand: claude, codexCommand: codex })}), /stock|runtime/i);`;
  // The parent itself receives only synthetic state; no operator credentials
  // need to be read, copied or placed into this regression's environment.
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', invoke], {
    cwd: root,
    env: { PATH: process.env.PATH, HIVE_MIND_GATE_ENV_SENTINEL: 'synthetic-not-a-credential' },
    maxBuffer: 64 * 1024,
    signal: AbortSignal.timeout(8000),
  });
  const children = (await readFile(capture, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  assert.deepEqual(
    children.map(child => child.mode),
    ['claude-version', 'codex-version', 'stock']
  );
  assert.ok(
    children.every(child => !child.inherited),
    'the fresh CLI probe must not inherit credentials or config overrides'
  );
  assert.ok(
    children.every(child => child.privateHome),
    'version checks also need disposable homes'
  );
});
