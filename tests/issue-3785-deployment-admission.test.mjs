/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
const source = await fs.readFile(new URL('../coolify/start.sh', import.meta.url), 'utf8');
// Ask bash to parse the actual su argument without executing root setup or su.
const invocation = source.slice(source.lastIndexOf('exec su -p -s /bin/bash box -c '));
assert.ok(invocation.startsWith('exec su '));
const { stdout } = await execute('bash', ['-c', `capture_su() { printf '%s\\0' "$@"; }\n${invocation.replace(/^exec su/u, 'capture_su')}`], { maxBuffer: 64 * 1024 });
const payload = stdout.split('\0').filter(Boolean).at(-1);

async function start(t, { gate = 0, hive = 0, auth = 0, url = 'https://github.com/synthetic/repo' } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-deploy-admission-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const trace = path.join(directory, 'trace');
  // All external startup operations are mocked. Never read an operator home,
  // execute a native CLI or contact a provider in this wiring regression.
  const mocks = `
    cd() { builtin cd "$FIXTURE_DIR"; }
    gh() { return "$AUTH_STATUS"; }
    hive() { return 0; }
    node() {
      case "$1" in
        */verify-agent-runtime.mjs) echo gate >> "$TRACE"; return "$GATE_STATUS" ;;
        hive.mjs) echo hive >> "$TRACE"; return "$HIVE_STATUS" ;;
        *) return 99 ;;
      esac
    }
    tail() { echo kept-alive >> "$TRACE"; return 0; }
  `;
  let code = 0;
  try {
    await execute('bash', ['-c', `${mocks}\n${payload}`], {
      env: { PATH: process.env.PATH, HOME: directory, FIXTURE_DIR: directory, TRACE: trace, GATE_STATUS: String(gate), HIVE_STATUS: String(hive), AUTH_STATUS: String(auth), GITHUB_URL: url },
      maxBuffer: 64 * 1024,
    });
  } catch (error) {
    code = error.code;
  }
  return { code, trace: (await fs.readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean) };
}

test('deployment rejects a contaminated restored home before starting hive', async t => {
  const result = await start(t, { gate: 23 });
  assert.equal(result.code, 23);
  assert.deepEqual(result.trace, ['gate']);
});

test('missing GitHub setup cannot hide a failed global baseline', async t => {
  const result = await start(t, { gate: 23, auth: 1, url: '' });
  assert.equal(result.code, 23);
  assert.deepEqual(result.trace, ['gate']);
});

test('startup failure remains a failed deployment after a clean baseline', async t => {
  const result = await start(t, { hive: 17 });
  assert.equal(result.code, 17);
  assert.deepEqual(result.trace, ['gate', 'hive']);
});

test('a clean deployment starts hive after its installed runtime check', async t => {
  const result = await start(t);
  assert.equal(result.code, 0);
  assert.deepEqual(result.trace, ['gate', 'hive']);
});

test('a clean unconfigured deployment retains the existing setup terminal', async t => {
  const result = await start(t, { auth: 1, url: '' });
  assert.equal(result.code, 0);
  assert.deepEqual(result.trace, ['gate', 'kept-alive']);
});
