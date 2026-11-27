/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { verifyAgentRuntime } from '../src/verify-agent-runtime.mjs';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';

const skill = 'create-statusline/SKILL.md';
const skillContents = 'A stock skill from the test runtime.';

async function fixture(t, { packageVersion = '0.172.0', codexVersion = packageVersion, claudeLabel = '2.1.332 (Claude Code)', scope = 'system' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-4169-stock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'operator');
  const stock = path.join(homeDir, '.codex/skills/.system');
  await mkdir(path.join(stock, path.dirname(skill)), { recursive: true });
  await writeFile(path.join(stock, skill), skillContents);
  await writeFile(path.join(homeDir, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\napps = false\n');
  await mkdir(path.join(homeDir, '.claude'));
  await writeFile(path.join(homeDir, '.claude/settings.json'), JSON.stringify({ syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } }));
  await writeFile(path.join(homeDir, '.codex/auth.json'), 'credential sentinel');
  const packageRoot = path.join(root, 'node_modules/@openai/codex');
  const entrypoint = path.join(packageRoot, 'bin/codex.js');
  const bin = path.join(root, 'bin');
  const codexCommand = path.join(bin, 'codex');
  const claudeCommand = path.join(bin, 'claude');
  await mkdir(path.dirname(entrypoint), { recursive: true });
  await mkdir(bin);
  await symlink(entrypoint, codexCommand);
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex', version: packageVersion, type: 'module', bin: { codex: 'bin/codex.js' } }));
  await writeFile(claudeCommand, `#!/bin/sh\nprintf '%s\\n' '${claudeLabel}'\n`, { mode: 0o700 });
  await writeFile(
    entrypoint,
    `#!${process.execPath}
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
assert.notEqual(process.env.HOME, ${JSON.stringify(homeDir)});
assert.equal(process.env.OPENAI_API_KEY, undefined);
appendFileSync(${JSON.stringify(path.join(root, 'probes'))}, process.argv.at(-1) + '\\n');
if (process.argv.includes('--version')) {
  console.log(${JSON.stringify(`codex-cli ${codexVersion}`)});
} else {
  const file = path.join(process.env.CODEX_HOME, 'skills/.system', ${JSON.stringify(skill)});
  const lines = readline.createInterface({input: process.stdin});
  lines.on('line', line => {
    const { id, method } = JSON.parse(line);
    if (method === 'initialize') console.log(JSON.stringify({id, result: {}}));
    if (method !== 'skills/list') return;
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, ${JSON.stringify(skillContents)});
    const skills = [{name: 'create-statusline', path: file, scope: ${JSON.stringify(scope)}, enabled: true, pluginId: null}];
    console.log(JSON.stringify({id, result: {data: [{cwd: process.cwd(), skills, errors: []}]}}));
  });
}
`,
    { mode: 0o700 }
  );
  const env = { PATH: bin, HIVE_MIND_ALLOW_STOCK_CODEX: '1', OPENAI_API_KEY: 'synthetic probe credential' };
  return { root, homeDir, stock, env, codexCommand, claudeCommand, geminiCommand: path.join(root, 'missing-gemini') };
}

test('new Claude and Codex reach the independent Gemini gate after checking the selected stock runtime', { timeout: 10000 }, async t => {
  const options = await fixture(t);
  await assert.rejects(verifyAgentRuntime(options), /native Gemini command could not be verified/u);
  assert.match(await readFile(path.join(options.root, 'probes'), 'utf8'), /--version\napp-server/u);
  assert.equal(await readFile(path.join(options.homeDir, '.codex/auth.json'), 'utf8'), 'credential sentinel');
});

test('direct verifier calls read the stock override from the process environment', { timeout: 10000 }, async t => {
  const options = await fixture(t);
  const source = `import assert from 'node:assert/strict';
import { verifyAgentRuntime } from ${JSON.stringify(new URL('../src/verify-agent-runtime.mjs', import.meta.url).href)};
await assert.rejects(verifyAgentRuntime(), /native Gemini command could not be verified/u);`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source], { env: { ...options.env, HOME: options.homeDir } });
  assert.match(await readFile(path.join(options.root, 'probes'), 'utf8'), /--version\napp-server/u);
});

test('the stock override validates persisted skill bytes and refuses changed content', { timeout: 10000 }, async t => {
  const options = await fixture(t, { packageVersion: '0.999.0' });
  await runAgentConfigAudit({ ...options, tool: 'codex', autoRepair: false, requireClean: true });
  await writeFile(path.join(options.stock, skill), 'changed');
  await assert.rejects(runAgentConfigAudit({ ...options, tool: 'codex', autoRepair: false, requireClean: true }), { name: 'Error', message: /stock runtime/u });
  assert.equal(await readFile(path.join(options.stock, skill), 'utf8'), 'changed');
});

for (const [name, fields, error] of [
  ['a version label from another CLI', { claudeLabel: '2.1.332 (Another CLI)' }, /invalid version label/u],
  ['a Codex label that disagrees with its package', { codexVersion: '0.171.0' }, /version differs from the selected package/u],
  ['a skill outside the system scope', { scope: 'user' }, /stock skill discovery is not pristine/u],
]) {
  test(`stock mode refuses ${name}`, { timeout: 10000 }, async t => {
    const options = await fixture(t, fields);
    await rm(options.stock, { recursive: true });
    await assert.rejects(verifyAgentRuntime(options), error);
  });
}

for (const [name, override] of [
  ['without opt-in', { HIVE_MIND_ALLOW_STOCK_CODEX: '0' }],
  ['with native credential storage selected', { CODEX_AUTH_HOME: '/synthetic/native-auth' }],
]) {
  test(`the verifier refuses stock Codex ${name} before executing it`, { timeout: 10000 }, async t => {
    const options = await fixture(t);
    await rm(options.stock, { recursive: true });
    Object.assign(options.env, override);
    await assert.rejects(verifyAgentRuntime(options), /installed native Codex command could not be verified/u);
    await assert.rejects(readFile(path.join(options.root, 'probes')), { code: 'ENOENT' });
  });
}
