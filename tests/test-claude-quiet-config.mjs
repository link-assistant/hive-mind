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

// Dockerfile-level verification. Release Docker builds run only after npm has
// published the Hive-Mind package version, so Dockerfiles install the exact
// published package and invoke its `configure-claude` bin directly. The actual
// key/value coverage is enforced by the configure-claude bin test above.
for (const file of ['Dockerfile', 'coolify/Dockerfile']) {
  const content = await fs.readFile(path.join(process.cwd(), file), 'utf-8');
  for (const [name, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ENV)) {
    assert.ok(content.includes(`${name}=${value}`), `${file} should set ${name}=${value} via ENV`);
  }
  assert.ok(!content.includes('CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS'), `${file} should not set CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS — built-in git instructions are kept on`);
  assert.ok(content.includes('ARG HIVE_MIND_VERSION=latest'), `${file} should accept the published hive-mind version as a build arg`);
  assert.ok(content.includes('bun install -g "@link-assistant/hive-mind@${HIVE_MIND_VERSION}"'), `${file} should install the published hive-mind package`);
  assert.ok(content.includes('configure-claude --settings-path /home/box/.claude/settings.json'), `${file} should invoke the published configure-claude bin to seed ~/.claude/settings.json`);
  assert.ok(content.includes('configure-claude --settings-path /home/box/.claude/settings.json --verify'), `${file} should verify the seeded Claude settings`);
  assert.ok(!content.includes('/workspace/.hive-mind-bake'), `${file} should not copy repo source into a bake directory`);
  assert.ok(!content.includes('scripts/configure-claude-quiet-defaults.mjs'), `${file} should not invoke the old repo-local wrapper script`);
  assert.ok(!content.includes('src/claude-quiet-config.lib.mjs'), `${file} should not COPY quiet config source libs`);
  assert.ok(content.includes('issue #1642'), `${file} should reference issue #1642`);
}

console.log('Claude quiet configuration tests passed');
