#!/usr/bin/env node
// Native path contracts inspected in the pinned installed sources; no CLI runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildRouterTaskEnv } from '../../src/router-isolation.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../../src/router-routes.lib.mjs';
import { assertRouterTaskAuthentication, startRouterAuthGuard } from '../../src/router-auth-guard.lib.mjs';
import { setTimeout as delay } from 'node:timers/promises';

function fixture(t, tool) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'router-native-auth-store-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cwd = path.join(home, 'workspace');
  fs.mkdirSync(cwd);
  const env = { ...buildRouterTaskEnv({ tool, baseUrl: 'https://router.invalid', token: 'synthetic-router-task', homeDir: home, dialect: ROUTER_ROUTE_DIALECTS.canonical }), HOME: home };
  return { home, cwd, env };
}

const conventionalFile = (f, tool) => (['agent', 'opencode'].includes(tool) ? path.join(f.home, '.local/share', tool === 'agent' ? 'link-assistant-agent' : 'opencode', 'auth.json') : path.join(f.home, `.${tool}`, 'oauth_creds.json'));

for (const tool of ['agent', 'opencode', 'gemini', 'qwen']) {
  const modes = ['agent', 'opencode'].includes(tool) ? ['default', 'xdg', 'relative-data'] : ['default', 'config', 'relative-config', ...(tool === 'qwen' ? ['tilde-config'] : []), 'auth'];
  for (const mode of modes)
    for (const disposition of ['healthy', 'credential', 'directory', 'symlink', 'invalid-utf8']) {
      test(`Router ${tool} ${mode} native credential store: ${disposition}`, { timeout: 10_000 }, t => {
        const f = fixture(t, tool);
        let root;
        let name;
        if (['agent', 'opencode'].includes(tool)) {
          if (mode === 'xdg') f.env.XDG_DATA_HOME = path.join(f.home, 'selected-data');
          if (mode === 'relative-data') f.env.XDG_DATA_HOME = 'relative-data';
          root = path.resolve(f.cwd, f.env.XDG_DATA_HOME || path.join(f.home, '.local/share'), tool === 'agent' ? 'link-assistant-agent' : 'opencode');
          name = 'auth.json';
        } else {
          root = path.join(f.home, `.${tool}`);
          if (mode === 'config' && tool === 'gemini') {
            f.env.GEMINI_CLI_HOME = path.join(f.home, 'private-config');
            root = path.join(f.env.GEMINI_CLI_HOME, '.gemini');
          }
          if (mode === 'config' && tool === 'qwen') f.env.QWEN_HOME = root = path.join(f.home, 'private-config');
          if (mode === 'relative-config') {
            f.env[tool === 'gemini' ? 'GEMINI_CLI_HOME' : 'QWEN_HOME'] = 'relative-config';
            root = path.join(f.cwd, 'relative-config', ...(tool === 'gemini' ? ['.gemini'] : []));
          }
          if (mode === 'tilde-config') {
            f.env.QWEN_HOME = '~/selected-config';
            root = path.join(f.home, 'selected-config');
          }
          if (mode === 'auth') f.env[`${tool.toUpperCase()}_AUTH_HOME`] = root = path.join(f.home, 'selected-auth');
          name = 'oauth_creds.json';
        }
        const file = path.join(root, name);
        fs.mkdirSync(root, { recursive: true });
        if (disposition === 'credential') {
          const value = ['agent', 'opencode'].includes(tool) ? { anthropic: { type: 'api', key: 'SYNTHETIC-NON-ROUTER-AUTHORITY' } } : { access_token: 'SYNTHETIC-NON-ROUTER-AUTHORITY', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expiry_date: 4_102_444_800_000 };
          fs.writeFileSync(file, JSON.stringify(value));
        }
        if (disposition === 'directory') fs.mkdirSync(file);
        if (disposition === 'symlink') fs.symlinkSync(path.join(f.home, 'missing-target'), file);
        if (disposition === 'invalid-utf8') fs.writeFileSync(file, Buffer.from([0xff]));
        if (disposition === 'healthy') assert.doesNotThrow(() => assertRouterTaskAuthentication({ tool, ...f }));
        else
          assert.throws(
            () => assertRouterTaskAuthentication({ tool, ...f }),
            error => error.code === 'ROUTER_AUTH_VIOLATION' && error.routerAuthViolation.violations.some(v => v.path === file) && !error.message.includes('SYNTHETIC-NON-ROUTER-AUTHORITY')
          );
      });
    }
}

for (const tool of ['agent', 'opencode', 'gemini', 'qwen']) {
  test(`Router ${tool} retains a runtime native store violation after removal`, { timeout: 10_000 }, async t => {
    const f = fixture(t, tool);
    const file = conventionalFile(f, tool);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let stops = 0;
    const guard = startRouterAuthGuard({
      tool,
      ...f,
      intervalMs: 100,
      onViolation: () => {
        stops++;
      },
    });
    t.after(() => guard.stop());
    await guard.first;
    assert.equal(guard.violation, null);
    fs.writeFileSync(file, '{"synthetic":"unrelated credential"}');
    for (let count = 0; count < 50 && !stops; count++) await delay(10);
    fs.unlinkSync(file);
    await guard.check();
    assert.equal(stops, 1, 'stop once before releasing the runtime authority');
    assert.ok(
      guard.violation?.violations.some(v => v.path === file),
      'removal cannot clear the retained security decision'
    );
  });
  test(`Unselected ${tool} preserves its ordinary credential store`, { timeout: 10_000 }, t => {
    const f = fixture(t, tool);
    f.env.HIVE_MIND_USE_ROUTER = '0';
    const file = conventionalFile(f, tool);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'synthetic ordinary authority');
    assert.doesNotThrow(() => assertRouterTaskAuthentication({ tool, ...f }));
    assert.equal(startRouterAuthGuard({ tool, ...f }).active, false, 'ordinary runs do not arm Router monitoring');
  });
}

test('Router OpenCode refuses its native fileless credential registry', { timeout: 10_000 }, t => {
  const f = fixture(t, 'opencode');
  f.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: 'api', key: 'SYNTHETIC-NON-ROUTER-AUTHORITY' } });
  assert.throws(
    () => assertRouterTaskAuthentication({ tool: 'opencode', ...f }),
    error => error.code === 'ROUTER_AUTH_VIOLATION' && !error.message.includes('SYNTHETIC-NON-ROUTER-AUTHORITY')
  );
});
