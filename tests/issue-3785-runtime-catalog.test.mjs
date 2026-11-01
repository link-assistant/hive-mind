/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CODEX_STOCK_SKILLS } from '../src/codex-stock-skills.lib.mjs';
import { verifyAgentRuntimeBaseline as verifyAgentRuntime } from '../src/verify-agent-runtime.mjs';
import { assertCodexStockSkillDiscovery } from '../src/codex-stock-catalog.lib.mjs';

test('the pinned native stock catalog is accepted independently of discovery order', () => {
  const home = '/synthetic/private-home';
  const cwd = '/synthetic/project';
  const skills = Object.keys(CODEX_STOCK_SKILLS.files)
    .filter(file => file.endsWith('/SKILL.md'))
    .map(file => ({ name: file.split('/')[0], path: path.join(home, '.codex/skills/.system', file), scope: 'system', enabled: true, pluginId: null }))
    .reverse();
  assert.doesNotThrow(() => assertCodexStockSkillDiscovery({ result: { data: [{ cwd, skills, errors: [] }] }, home, cwd }));
});

for (const variant of ['admin', 'user', 'repo', 'outside-stock', 'duplicate', 'missing', 'disabled', 'plugin', 'name', 'errors', 'wrong-cwd', 'missing-errors', 'malformed-skills', 'extra-result']) {
  test(`native stock discovery rejects ${variant} before trusting its file tree`, { timeout: 5000 }, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-catalog-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, '.codex'));
    await writeFile(path.join(root, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\napps = false\n');
    await mkdir(path.join(root, '.claude'));
    await writeFile(path.join(root, '.claude/settings.json'), JSON.stringify({ syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } }));
    const auth = path.join(root, '.codex/auth.json');
    await writeFile(auth, 'protected-synthetic-state');
    const before = await stat(auth);
    const claude = path.join(root, 'claude');
    await writeFile(claude, '#!/bin/sh\nprintf "%s\\n" "2.1.310 (Claude Code)"\n', { mode: 0o700 });
    const codex = path.join(root, 'codex.mjs');
    const entries = Object.keys(CODEX_STOCK_SKILLS.files).filter(file => file.endsWith('/SKILL.md'));
    await writeFile(
      codex,
      `#!${process.execPath}
import path from 'node:path';
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli 0.164.0'); process.exit(0); }
readline.createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  let result = {};
  if (message.method === 'skills/list') {
    const skills = ${JSON.stringify(entries)}.map(file => ({name: file.split('/')[0], path: path.join(process.env.CODEX_HOME, 'skills/.system', file), scope: 'system', enabled: true, pluginId: null}));
    const entry = {cwd: process.cwd(), skills, errors: []};
    const variant = ${JSON.stringify(variant)};
    if (['admin', 'user', 'repo'].includes(variant)) skills.push({name: 'synthetic-unapproved', path: '/synthetic/private/SKILL.md', scope: variant, enabled: true});
    if (variant === 'outside-stock') skills[0].path = '/synthetic/private/SKILL.md';
    if (variant === 'duplicate') skills[1] = skills[0];
    if (variant === 'missing') skills.pop();
    if (variant === 'disabled') skills[0].enabled = false;
    if (variant === 'plugin') skills[0].pluginId = 'synthetic-unapproved';
    if (variant === 'name') skills[0].name = 'synthetic-unapproved';
    if (variant === 'errors') entry.errors = [{path: '/synthetic/private', message: 'private_error_sentinel'}];
    if (variant === 'wrong-cwd') entry.cwd = '/synthetic/private';
    if (variant === 'missing-errors') delete entry.errors;
    if (variant === 'malformed-skills') entry.skills = {};
    result = {data: variant === 'extra-result' ? [entry, entry] : [entry]};
  }
  if (message.id) console.log(JSON.stringify({id: message.id, result}));
});
`,
      { mode: 0o700 }
    );
    await assert.rejects(verifyAgentRuntime({ homeDir: root, claudeCommand: claude, codexCommand: codex }), error => error.message === 'Codex stock skill discovery is not pristine. Inspect native search paths and restore the pinned catalog before admission.');
    assert.equal(await readFile(auth, 'utf8'), 'protected-synthetic-state');
    assert.equal((await stat(auth)).ino, before.ino);
  });
}
