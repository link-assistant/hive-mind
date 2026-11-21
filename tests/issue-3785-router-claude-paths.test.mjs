/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inspectRouterAuthSurface } from '../src/router-auth-guard.lib.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-claude-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const cwd = path.join(root, 'workspace');
  const config = path.join(root, 'config');
  const secure = path.join(root, 'secure');
  for (const dir of [homeDir, cwd, config, secure]) fs.mkdirSync(dir, { recursive: true });
  const env = { CLAUDE_CONFIG_DIR: config, CLAUDE_SECURESTORAGE_CONFIG_DIR: secure, ANTHROPIC_AUTH_TOKEN: 'synthetic-router-token' };
  return { homeDir, cwd, config, secure, env };
}

for (const location of ['secure', 'config']) {
  test(`Router refuses native OAuth in the selected Claude ${location} directory`, t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f[location], '.credentials.json'), '{}');
    assert.equal(inspectRouterAuthSurface(f).violations.length, 1);
  });
}

test('Router refuses account auth in the relocated native Claude state file', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.config, '.claude.json'), JSON.stringify({ primaryApiKey: 'synthetic-vendor-key' }));
  assert.equal(inspectRouterAuthSurface(f).violations.length, 1);
});

test('Router refuses auth helpers in the selected Claude settings root', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.config, 'settings.json'), JSON.stringify({ apiKeyHelper: 'never-run-this' }));
  assert.equal(inspectRouterAuthSurface(f).violations.length, 1);
});

for (const selector of ['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_HOST_CREDS_FILE', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR']) {
  test(`Router refuses settings redirecting ${selector}`, t => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.homeDir, '.claude'));
    fs.writeFileSync(path.join(f.homeDir, '.claude/settings.json'), JSON.stringify({ env: { [selector]: '/unapproved-synthetic-state' } }));
    assert.equal(inspectRouterAuthSurface(f).violations.length, 1);
  });
}

test('Router accepts selected settings that repeat the launch authority and keeps private permissions', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.config, 'settings.json'), JSON.stringify({ env: f.env, permissions: { allow: ['Read'] } }));
  assert.equal(inspectRouterAuthSurface(f).violations.length, 0);
});
