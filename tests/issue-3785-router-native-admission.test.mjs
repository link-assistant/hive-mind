/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildRouterTaskEnv } from '../src/router-isolation.lib.mjs';
import { inspectRouterAuthSurface, isRouterAuthGuardRequired, resolveRouterAuthGuardIntervalMs, startRouterAuthGuard } from '../src/router-auth-guard.lib.mjs';

function fixture(t) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-admission-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const cwd = path.join(homeDir, 'workspace');
  const codexHome = path.join(homeDir, '.codex');
  for (const dir of [cwd, codexHome, path.join(homeDir, '.claude')]) fs.mkdirSync(dir);
  const router = { baseUrl: 'https://router.invalid', token: 'synthetic-router-task', homeDir };
  const env = { ...buildRouterTaskEnv({ ...router, tool: 'claude' }), ...buildRouterTaskEnv({ ...router, tool: 'codex' }) };
  const configPath = path.join(codexHome, 'config.toml');
  const pinned = 'model_provider = "hive-mind-router"\n[model_providers.hive-mind-router]\nbase_url = "https://router.invalid/v1"\nenv_key = "OPENAI_API_KEY"\n';
  fs.writeFileSync(configPath, pinned);
  return { homeDir, cwd, env, configPath, pinned };
}

for (const disabled of ['0', 'false', 'no', 'off']) {
  test(`Router guard cannot be disabled with ${disabled}`, { timeout: 10_000 }, t => {
    const f = fixture(t);
    assert.equal(isRouterAuthGuardRequired({ ...f.env, HIVE_MIND_ROUTER_AUTH_GUARD: disabled }), true);
  });
}

test('Router selection without a task token is a violation', { timeout: 10_000 }, async t => {
  const f = fixture(t);
  const guard = startRouterAuthGuard({ ...f, env: { ...f.env, HIVE_MIND_ROUTER_TOKEN: '' }, setIntervalImpl: () => ({}), clearIntervalImpl: () => {} });
  t.after(() => guard.stop());
  const violation = await guard.first;
  assert.ok(violation, 'missing token must not turn the guard off');
  assert.match(violation.violations[0].reason, /router task token/i);
});

test('The periodic Router check cannot be postponed by its interval override', { timeout: 10_000 }, () => {
  assert.equal(resolveRouterAuthGuardIntervalMs({ HIVE_MIND_ROUTER_AUTH_GUARD_INTERVAL_MS: '60000' }), 1000);
});

for (const text of ['model_provider = "hive-mind-router"\n[model_providers.\'hive-mind-router\']\n"base_url" = "https://vendor.invalid/v1"\n"env_key" = "VENDOR_KEY"\n', 'model_provider = "hive-mind-router"\nmodel_providers.hive-mind-router.base_url = "https://vendor.invalid/v1"\nmodel_providers.hive-mind-router.env_key = "VENDOR_KEY"\n', 'model_provider = "hive-mind-router"\n[model_providers.hive-mind-router]\n', 'model_provider = "hive-mind-router"\n[model_providers.hive-mind-router]\nbase_url = "https://router.invalid/v1"\n']) {
  test(`Codex rejects incomplete or redirected provider: ${JSON.stringify(text)}`, { timeout: 10_000 }, t => {
    const f = fixture(t);
    fs.writeFileSync(f.configPath, text);
    assert.ok(inspectRouterAuthSurface({ ...f, tool: 'codex' }).violations.some(v => v.kind === 'codex-config'));
  });
}

for (const text of ['"model_provider" = "openai"\n', 'model_providers.hive-mind-router.base_url = "https://vendor.invalid/v1"\n', '[profiles.vendor]\nmodel_provider = "openai"\n', 'approval_policy = "never"\napproval_policy = "on-request"\n']) {
  test(`Codex rejects project provider overrides or invalid TOML: ${JSON.stringify(text)}`, { timeout: 10_000 }, t => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.cwd, '.codex'));
    fs.writeFileSync(path.join(f.cwd, '.codex', 'config.toml'), text);
    assert.ok(inspectRouterAuthSurface({ ...f, tool: 'codex' }).violations.some(v => v.kind === 'codex-project-config'));
  });
}

test('Codex accepts equivalent TOML quoting and private trust settings', { timeout: 10_000 }, t => {
  const f = fixture(t);
  fs.writeFileSync(f.configPath, '"model_provider" = "hive-mind-router"\n[model_providers.\'hive-mind-router\']\n"base_url" = "https://router.invalid/v1"\n"env_key" = "OPENAI_API_KEY"\n[projects."/private/#workspace"]\ntrust_level = "trusted"\n');
  assert.deepEqual(inspectRouterAuthSurface({ ...f, tool: 'codex' }).violations, []);
});

for (const kind of ['malformed', 'array', 'directory', 'invalid-env']) {
  test(`Claude refuses ${kind} settings during admission`, { timeout: 10_000 }, t => {
    const f = fixture(t);
    const settings = path.join(f.homeDir, '.claude', 'settings.json');
    if (kind === 'directory') fs.mkdirSync(settings);
    else fs.writeFileSync(settings, kind === 'malformed' ? '{"env":' : kind === 'invalid-env' ? '{"env":[]}' : '[]');
    assert.ok(inspectRouterAuthSurface({ ...f, tool: 'claude' }).violations.some(v => v.kind === 'claude-settings'));
  });
}

test('An unreadable credential path is refused rather than treated as absent', { timeout: 10_000 }, t => {
  const f = fixture(t);
  const unreadable = path.join(f.homeDir, '.claude', '.credentials.json');
  const fsImpl = {
    ...fs,
    openSync(file, ...args) {
      if (file === unreadable) throw Object.assign(new Error('synthetic permission error'), { code: 'EACCES' });
      return fs.openSync(file, ...args);
    },
    readFileSync(file, ...args) {
      if (file === unreadable) throw Object.assign(new Error('synthetic permission error'), { code: 'EACCES' });
      return fs.readFileSync(file, ...args);
    },
  };
  const result = inspectRouterAuthSurface({ ...f, tool: 'claude', fsImpl });
  assert.ok(result.violations.some(v => v.path === unreadable));
});

test('Non-Router execution keeps the guard inactive', { timeout: 10_000 }, () => {
  assert.equal(isRouterAuthGuardRequired({ HIVE_MIND_ROUTER_AUTH_GUARD: '1' }), false);
});

for (const kind of ['symlink', 'oversized', 'invalid-utf8']) {
  test(`Router refuses ${kind} files without reading an unbounded credential surface`, { timeout: 10_000 }, t => {
    const f = fixture(t);
    const settings = path.join(f.homeDir, '.claude', 'settings.json');
    if (kind === 'symlink') fs.symlinkSync(path.join(f.homeDir, 'absent-target'), settings);
    else if (kind === 'oversized') {
      fs.closeSync(fs.openSync(settings, 'w'));
      fs.truncateSync(settings, 1024 * 1024 + 1);
    } else fs.writeFileSync(settings, Buffer.from([0xff]));
    assert.ok(inspectRouterAuthSurface({ ...f, tool: 'claude' }).violations.some(v => v.path === settings));
  });
}

test('A FIFO credential path is refused without blocking the guard', { timeout: 10_000 }, t => {
  const f = fixture(t);
  const fifo = path.join(f.homeDir, '.claude', '.credentials.json');
  const create = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 5000 });
  assert.equal(create.status, 0, create.stderr);
  // Bound the subprocess too: a future regression to readFileSync(path) must
  // not block the whole test runner in a synchronous FIFO read.
  const script = `import { inspectRouterAuthSurface } from ${JSON.stringify(new URL('../src/router-auth-guard.lib.mjs', import.meta.url).href)}; const result = inspectRouterAuthSurface(JSON.parse(process.argv[1])); process.exit(result.violations.some(v => v.path === process.argv[2]) ? 0 : 1);`;
  const probe = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', script, JSON.stringify({ ...f, tool: 'claude' }), fifo], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  assert.equal(probe.error, undefined, 'a FIFO must not block authentication inspection');
  assert.equal(probe.status, 0, probe.stderr);
});

test('TOML parsing failures do not expose credential source text', { timeout: 10_000 }, t => {
  const f = fixture(t);
  fs.writeFileSync(f.configPath, `${f.pinned}experimental_bearer_token = "SYNTHETIC-PRIVATE-SENTINEL\n`);
  const result = inspectRouterAuthSurface({ ...f, tool: 'codex' });
  assert.ok(result.violations.some(v => v.kind === 'codex-config'));
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-PRIVATE-SENTINEL/);
});

test('Provider refusal does not echo untrusted TOML values', { timeout: 10_000 }, t => {
  const f = fixture(t);
  fs.writeFileSync(f.configPath, f.pinned.replace('model_provider = "hive-mind-router"', 'model_provider = "SYNTHETIC-PRIVATE-SENTINEL"'));
  const result = inspectRouterAuthSurface({ ...f, tool: 'codex' });
  assert.ok(result.violations.some(v => v.kind === 'codex-config'));
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-PRIVATE-SENTINEL/);
});

test('The guard uses the native process HOME when supplied in its launch environment', { timeout: 10_000 }, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.homeDir, '.claude', '.credentials.json'), '{}');
  const result = inspectRouterAuthSurface({ cwd: f.cwd, env: { ...f.env, HOME: f.homeDir }, tool: 'claude' });
  assert.ok(result.violations.some(v => v.path === path.join(f.homeDir, '.claude', '.credentials.json')));
});
