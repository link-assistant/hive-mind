// Native-command acceptance probe for the pinned source adapter. The unpatched
// CLI must fail this probe: CODEX_HOME alone cannot separate rotating auth.
// Uses synthetic API-key-shaped data, no inference and disposable native state.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const binary = process.argv[2];
assert.ok(binary && path.isAbsolute(binary), 'Supply an absolute Codex binary path.');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-codex-native-auth-'));
try {
  const home = path.join(root, 'home');
  const canonical = path.join(root, 'canonical');
  const config = path.join(root, 'config');
  const otherConfig = path.join(root, 'other-config');
  for (const dir of [home, canonical, config, otherConfig]) await fs.mkdir(dir, { mode: 0o700 });
  const credential = JSON.stringify({ OPENAI_API_KEY: 'sk-SYNTHETIC-NOT-A-PROVIDER-KEY' });
  const auth = path.join(canonical, 'auth.json');
  await fs.writeFile(auth, credential, { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: config, CODEX_AUTH_HOME: canonical, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', RUST_LOG: 'off' };
  const run = async (args, extra = {}, input = '') => {
    try {
      const pending = execute('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', binary, ...args], { env: { ...env, ...extra }, cwd: home, maxBuffer: 64 * 1024, signal: globalThis.AbortSignal.timeout(15_000), killSignal: 'SIGKILL' });
      pending.child.stdin.end(input);
      await pending;
      return 0;
    } catch (error) {
      if (Number.isInteger(error.code)) return error.code;
      const reason = error.signal || error.code || 'unknown';
      for (const key of Reflect.ownKeys(error)) delete error[key];
      error.message = `Native process did not complete (${reason}).`;
      throw new Error('Disposable native Codex process failed.', { cause: error });
    }
  };
  assert.equal(await run(['login', 'status']), 0, 'Native status must read canonical auth outside its configuration home.');
  assert.equal(await run(['login', 'status'], { CODEX_HOME: otherConfig }), 0, 'A different configuration home must read the same authority.');
  assert.equal(await run(['login', '--with-api-key'], { CODEX_HOME: otherConfig }, 'sk-SYNTHETIC-REAUTHENTICATED\n'), 0, 'Native reauthentication must commit to the selected canonical authority.');
  assert.equal(JSON.parse(await fs.readFile(auth, 'utf8')).OPENAI_API_KEY, 'sk-SYNTHETIC-REAUTHENTICATED');
  assert.equal(await run(['login', 'status']), 0, 'A peer must see canonical native reauthentication.');
  for (const dir of [config, otherConfig]) await assert.rejects(fs.access(path.join(dir, 'auth.json')), { code: 'ENOENT' });
  await fs.rename(auth, path.join(canonical, 'prior-synthetic-generation'));
  await fs.writeFile(auth, credential, { mode: 0o600, flag: 'wx' });
  assert.equal(await run(['login', 'status']), 0, 'Native status must follow canonical atomic replacement.');
  assert.equal(await run(['logout']), 0, 'Native logout must operate on canonical storage.');
  await assert.rejects(fs.access(auth), { code: 'ENOENT' });
  assert.notEqual(await run(['login', 'status'], { CODEX_HOME: otherConfig }), 0, 'A peer must see canonical logout.');
  // A configured missing authority must not fall back to task-local credentials.
  await fs.writeFile(path.join(config, 'auth.json'), credential, { mode: 0o600 });
  assert.notEqual(await run(['login', 'status'], { CODEX_AUTH_HOME: path.join(root, 'missing') }), 0);
  assert.equal(await fs.readFile(path.join(config, 'auth.json'), 'utf8'), credential);
  await fs.writeFile(auth, credential, { mode: 0o600 });
  assert.notEqual(await run(['login', 'status']), 0, 'An independent scoped credential copy must stop admission, even when contents match.');
  assert.equal(await run(['login', 'status'], { CODEX_HOME: otherConfig }), 0, 'A clean configuration home still reads the canonical generation.');
  assert.notEqual(await run(['login', 'status'], { CODEX_HOME: otherConfig, CODEX_API_KEY: 'sk-SYNTHETIC-PRIVATE-OVERRIDE' }), 0, 'Environment credentials must not silently override canonical selection.');
  console.log('PASS: native Codex status/logout share a separate authority across configuration homes and canonical replacement, without copies or missing-root fallback.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
