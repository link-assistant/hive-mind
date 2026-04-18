#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureClaudeQuietConfig, REQUIRED_CLAUDE_QUIET_ENV, REQUIRED_CLAUDE_QUIET_SETTINGS, REQUIRED_CLAUDE_QUIET_ATTRIBUTION, REQUIRED_CLAUDE_QUIET_PERMISSIONS } from '../src/claude-quiet-config.lib.mjs';
import { getClaudeEnv } from '../src/config.lib.mjs';

const claudeEnv = getClaudeEnv();
for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ENV)) {
  assert.equal(claudeEnv[name], value, `getClaudeEnv should force ${name}=${value}`);
}

// CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS must NOT be forced — built-in git/PR
// guidance is useful for our solve runs (per maintainer feedback on PR #1643).
// The includeGitInstructions setting is what turns it on.
assert.ok(!Object.prototype.hasOwnProperty.call(REQUIRED_CLAUDE_QUIET_ENV, 'CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS'), 'REQUIRED_CLAUDE_QUIET_ENV must not disable git instructions — includeGitInstructions keeps them on');

const claudeLibContent = await fs.readFile(path.join(process.cwd(), 'src/claude.lib.mjs'), 'utf-8');
assert.ok(claudeLibContent.includes('ensureClaudeQuietConfig({ log })'), 'claude.lib should verify global Claude quiet config before launching Claude');
assert.ok(claudeLibContent.includes('--dangerously-skip-permissions'), 'claude.lib should still pass --dangerously-skip-permissions as belt-and-suspenders for the bypassPermissions defaultMode');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-quiet-config-'));
try {
  const settingsPath = path.join(tmp, 'settings.json');
  await fs.writeFile(
    settingsPath,
    JSON.stringify({
      theme: 'dark',
      disallowedTools: ['CustomTool'],
      attribution: {
        commit: 'custom-commit-trailer',
      },
      permissions: {
        additionalDirectories: ['/tmp/preserved'],
      },
      env: {
        CUSTOM_SETTING: 'preserved',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
      },
    })
  );

  const logs = [];
  const result = await ensureClaudeQuietConfig({ settingsPath, log: async line => logs.push(line) });
  const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));

  assert.equal(result.changed, true, 'first merge should update missing or incorrect target keys');
  assert.ok(
    logs.some(line => line.includes('Claude Code quiet config updated')),
    'merge should log the effective quiet configuration'
  );
  assert.equal(written.theme, 'dark', 'unrelated settings should be preserved');
  assert.deepEqual(written.disallowedTools, ['CustomTool'], 'existing unrelated arrays should be preserved');
  assert.deepEqual(written.permissions.additionalDirectories, ['/tmp/preserved'], 'unrelated permissions subkeys should be preserved');
  assert.equal(written.env.CUSTOM_SETTING, 'preserved', 'unrelated env values should be preserved');
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ENV)) {
    assert.equal(written.env[name], value, `settings env should force ${name}=${value}`);
  }
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_SETTINGS)) {
    assert.deepEqual(written[name], value, `settings should force ${name}=${JSON.stringify(value)}`);
  }
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ATTRIBUTION)) {
    assert.equal(written.attribution[name], value, `attribution should force ${name}=${JSON.stringify(value)}`);
  }
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_PERMISSIONS)) {
    assert.equal(written.permissions[name], value, `permissions should force ${name}=${JSON.stringify(value)}`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(written.env, 'CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS'), false, 'settings env should NOT set CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS — git instructions are kept on via includeGitInstructions');

  const secondResult = await ensureClaudeQuietConfig({ settingsPath, log: async () => {} });
  assert.equal(secondResult.changed, false, 'second merge should verify without rewriting already-correct config');
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

// Dockerfile-level verification. The quiet Claude Code configuration is applied
// by scripts/configure-claude-quiet-defaults.mjs (which reuses the canonical
// maps + idempotent merge helpers from the src/ libs tested above), so the
// Dockerfiles only need to (a) set the required env vars via `ENV` and
// (b) invoke the shared script. All key/value coverage is enforced by the
// end-to-end script run below.
for (const file of ['Dockerfile', 'coolify/Dockerfile']) {
  const content = await fs.readFile(path.join(process.cwd(), file), 'utf-8');
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ENV)) {
    assert.ok(content.includes(`${name}=${value}`), `${file} should set ${name}=${value} via ENV`);
  }
  assert.ok(!content.includes('CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS'), `${file} should not set CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS — built-in git instructions are kept on`);
  assert.ok(content.includes('scripts/configure-claude-quiet-defaults.mjs'), `${file} should invoke scripts/configure-claude-quiet-defaults.mjs to seed ~/.claude/settings.json`);
  assert.ok(content.includes('claude-quiet-config.lib.mjs') && content.includes('useless-tools.lib.mjs'), `${file} should COPY the src libs that the configure script reuses`);
  assert.ok(content.includes('issue #1642'), `${file} should reference issue #1642`);
}

// End-to-end: running scripts/configure-claude-quiet-defaults.mjs against a
// fresh settings file must produce exactly the keys/values required for every
// category (env, settings, attribution, permissions, disallowedTools).
const { spawn } = await import('node:child_process');
const runScript = async settingsPath =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/configure-claude-quiet-defaults.mjs', '--settings-path', settingsPath], { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`exit ${code}: ${stderr || stdout}`))));
  });

const { USELESS_CLAUDE_BUILTIN_TOOLS, USELESS_MCP_TOOL_NAME_PREFIXES } = await import('../src/useless-tools.lib.mjs');

const scriptTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-quiet-config-script-'));
try {
  const settingsPath = path.join(scriptTmp, 'settings.json');
  const { stdout: firstStdout } = await runScript(settingsPath);
  assert.ok(firstStdout.includes('Configured quiet Claude Code defaults'), 'script should print final summary line');
  const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ENV)) {
    assert.equal(written.env[name], value, `script should configure env.${name}=${value}`);
  }
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_SETTINGS)) {
    assert.deepEqual(written[name], value, `script should configure ${name}=${JSON.stringify(value)}`);
  }
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ATTRIBUTION)) {
    assert.equal(written.attribution[name], value, `script should configure attribution.${name}=${JSON.stringify(value)}`);
  }
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_PERMISSIONS)) {
    assert.equal(written.permissions[name], value, `script should configure permissions.${name}=${JSON.stringify(value)}`);
  }
  for (const tool of USELESS_CLAUDE_BUILTIN_TOOLS) {
    assert.ok(written.disallowedTools.includes(tool), `script should add ${tool} to disallowedTools`);
  }
  for (const prefix of USELESS_MCP_TOOL_NAME_PREFIXES) {
    assert.ok(written.disallowedTools.includes(`${prefix}__*`), `script should add ${prefix}__* to disallowedTools`);
  }
  // Idempotency: a second run must not duplicate tools or rewrite anything.
  await runScript(settingsPath);
  const written2 = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  assert.deepEqual(written2.disallowedTools, written.disallowedTools, 'second run should not duplicate disallowedTools entries');
} finally {
  await fs.rm(scriptTmp, { recursive: true, force: true });
}

console.log('Claude quiet configuration tests passed');
