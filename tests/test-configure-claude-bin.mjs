#!/usr/bin/env node

/**
 * Tests for the `configure-claude` bin command (src/configure-claude.mjs)
 * and its shared library (src/configure-claude.lib.mjs).
 *
 * Covers the maintainer request on PR #1643: ship a reusable, readable,
 * deduplicated bin command that users and system administrators can run
 * manually after installing `@link-assistant/hive-mind`, and that the
 * Dockerfiles reuse for the pre-seeded /workspace/.claude/settings.json.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { REQUIRED_CLAUDE_QUIET_ENV, REQUIRED_CLAUDE_QUIET_SETTINGS, REQUIRED_CLAUDE_QUIET_ATTRIBUTION, REQUIRED_CLAUDE_QUIET_PERMISSIONS } from '../src/claude-quiet-config.lib.mjs';
import { buildDisallowedToolsList } from '../src/useless-tools.lib.mjs';
import { CONFIGURE_CLAUDE_HELP, formatVerifyReport, parseConfigureClaudeArgs, resolveSettingsPath, runConfigureClaude, verifyConfigureClaude } from '../src/configure-claude.lib.mjs';

const runBin = (args = [], { cwd } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/configure-claude.mjs', ...args], {
      cwd: cwd || process.cwd(),
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });

// --- package.json contract ---
const pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8'));
assert.equal(pkg.bin['configure-claude'], './src/configure-claude.mjs', 'package.json should expose configure-claude as a bin command');
assert.ok(pkg.scripts['build:pre'].includes('chmod +x src/configure-claude.mjs'), 'build:pre should mark configure-claude.mjs executable');

// --- arg parsing ---
assert.deepEqual(parseConfigureClaudeArgs([]), { settingsPath: null, verify: false, help: false }, 'no args should yield defaults');
assert.deepEqual(parseConfigureClaudeArgs(['--verify']), { settingsPath: null, verify: true, help: false }, '--verify flag should be detected');
assert.deepEqual(parseConfigureClaudeArgs(['-s', '/tmp/a.json']), { settingsPath: '/tmp/a.json', verify: false, help: false }, '-s should set settingsPath');
assert.deepEqual(parseConfigureClaudeArgs(['--settings-path=/tmp/b.json']), { settingsPath: '/tmp/b.json', verify: false, help: false }, '--settings-path= should set settingsPath');
assert.deepEqual(parseConfigureClaudeArgs(['--help']), { settingsPath: null, verify: false, help: true }, '--help should be detected');

// --- resolveSettingsPath fallback ---
assert.equal(resolveSettingsPath('/explicit/path'), '/explicit/path', 'explicit path should be returned verbatim');
assert.equal(resolveSettingsPath(), path.join(os.homedir(), '.claude', 'settings.json'), 'default resolves to ~/.claude/settings.json');

// --- help text ---
assert.ok(CONFIGURE_CLAUDE_HELP.includes('configure-claude'), 'help text should mention the command name');
assert.ok(CONFIGURE_CLAUDE_HELP.includes('--verify'), 'help text should mention --verify');
assert.ok(CONFIGURE_CLAUDE_HELP.includes('issues/1642'), 'help text should reference issue #1642');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'configure-claude-bin-'));
try {
  const settingsPath = path.join(tmp, 'settings.json');

  // --- verify: missing settings file reports drift ---
  const missingReport = await verifyConfigureClaude({ settingsPath });
  assert.equal(missingReport.ok, false, 'verify should return ok=false when settings file is missing');
  assert.equal(missingReport.missing.file, true, 'verify should flag missing file');
  const missingFormatted = formatVerifyReport(missingReport);
  assert.ok(missingFormatted.includes('drift detected'), 'formatted drift report should mention drift');

  // --- bin: `configure-claude` applies the full configuration ---
  const applyResult = await runBin(['--settings-path', settingsPath]);
  assert.equal(applyResult.code, 0, `bin should exit 0 on apply. stderr: ${applyResult.stderr}`);
  assert.ok(applyResult.stdout.includes('Configured quiet Claude Code defaults'), 'bin should print summary line');

  const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ENV)) {
    assert.equal(written.env[key], value, `bin should configure env.${key}=${value}`);
  }
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_SETTINGS)) {
    assert.deepEqual(written[key], value, `bin should configure ${key}=${JSON.stringify(value)}`);
  }
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ATTRIBUTION)) {
    assert.equal(written.attribution[key], value, `bin should configure attribution.${key}`);
  }
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_PERMISSIONS)) {
    assert.equal(written.permissions[key], value, `bin should configure permissions.${key}`);
  }
  for (const required of buildDisallowedToolsList()) {
    assert.ok(written.disallowedTools.includes(required), `bin should add ${required} to disallowedTools`);
  }

  // --- bin: --verify succeeds against a correctly-configured file ---
  const verifyOk = await runBin(['--settings-path', settingsPath, '--verify']);
  assert.equal(verifyOk.code, 0, `--verify should exit 0 when configuration is correct. stderr: ${verifyOk.stderr}`);
  assert.ok(verifyOk.stdout.includes('up to date'), '--verify should print up-to-date summary');

  // --- bin: --verify fails with drift when keys are tampered with ---
  const tampered = { ...written };
  tampered.env = { ...tampered.env };
  delete tampered.env[Object.keys(REQUIRED_CLAUDE_QUIET_ENV)[0]];
  await fs.writeFile(settingsPath, JSON.stringify(tampered, null, 2));
  const verifyDrift = await runBin(['--settings-path', settingsPath, '--verify']);
  assert.equal(verifyDrift.code, 1, '--verify should exit 1 when drift is detected');
  assert.ok(verifyDrift.stdout.includes('drift detected'), '--verify should report drift');

  // --- bin: re-apply is idempotent on a second run ---
  await runBin(['--settings-path', settingsPath]);
  const idempotentVerify = await runBin(['--settings-path', settingsPath, '--verify']);
  assert.equal(idempotentVerify.code, 0, 'verify after re-apply should succeed');

  // --- library: runConfigureClaude returns structured results ---
  const libResult = await runConfigureClaude({ settingsPath, log: async () => {} });
  assert.equal(libResult.path, settingsPath, 'runConfigureClaude should echo resolved path');
  assert.ok(typeof libResult.quietResult.changed === 'boolean', 'quietResult.changed should be a boolean');
  assert.ok(typeof libResult.disallowedResult.total === 'number', 'disallowedResult.total should be a number');
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

// --- bin: --help prints usage without touching disk ---
const helpRun = await runBin(['--help']);
assert.equal(helpRun.code, 0, '--help should exit 0');
assert.ok(helpRun.stdout.includes('configure-claude'), '--help output should include command name');
assert.ok(helpRun.stdout.includes('--verify'), '--help output should advertise --verify');

console.log('configure-claude bin tests passed');
