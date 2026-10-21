/**
 * @hive-mind-test-suite default
 * Issue #3125: the AI CLI must not be the OOM killer's first choice. Every bash
 * tool shell the CLI starts raises its own oom_score_adj through a BASH_ENV
 * hook (raising needs no privileges), so builds and tests are killed first and
 * the CLI keeps its score. The launcher shell solve starts the CLI from is
 * skipped, because raising it would raise the CLI too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { armToolShellOomScoreAdj, buildToolShellOomEnv, buildToolShellOomHookScript, DEFAULT_TOOL_SHELL_OOM_SCORE_ADJ, defaultToolShellOomHookDir, ensureToolShellOomHook, resolveToolShellOomScoreAdj, TOOL_SHELL_OOM_HOOK_FILE } from '../src/tool-shell-oom-score.lib.mjs';

function memoryFs(files = {}) {
  const store = new Map(Object.entries(files));
  const writes = [];
  return {
    store,
    writes,
    readFileSync(file) {
      if (!store.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return store.get(file);
    },
    writeFileSync(file, content) {
      writes.push(file);
      store.set(file, content);
    },
  };
}

test('the score defaults to 500 and can be changed or disabled', () => {
  assert.equal(DEFAULT_TOOL_SHELL_OOM_SCORE_ADJ, 500);
  assert.equal(resolveToolShellOomScoreAdj({}), 500);
  assert.equal(resolveToolShellOomScoreAdj({ HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ: '800' }), 800);
  for (const value of ['off', '0', '1001', '-5', 'abc']) assert.equal(resolveToolShellOomScoreAdj({ HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ: value }), null, value);
});

test('the hook is written once to the injected fs', () => {
  const memfs = memoryFs();
  const hookPath = ensureToolShellOomHook({ fs: memfs, dir: '/tmp/x' });
  assert.equal(hookPath, path.join('/tmp/x', TOOL_SHELL_OOM_HOOK_FILE));
  assert.match(memfs.store.get(hookPath), /\/proc\/self\/oom_score_adj/);
  assert.equal(ensureToolShellOomHook({ fs: memfs, dir: '/tmp/x' }), hookPath);
  assert.equal(memfs.writes.length, 1, 'an unchanged hook is not rewritten');
  const readOnly = {
    readFileSync: () => '',
    writeFileSync: () => {
      throw new Error('EROFS');
    },
  };
  assert.equal(ensureToolShellOomHook({ fs: readOnly, dir: '/ro' }), null, 'an unwritable hook disables the feature');
});

test('the hook lives in a private per-user directory', () => {
  assert.equal(defaultToolShellOomHookDir(1001), path.join(os.tmpdir(), 'hive-mind-1001'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-oom-3125-'));
  try {
    const own = path.join(dir, 'own');
    assert.equal(ensureToolShellOomHook({ dir: own, uid: process.getuid?.() }), path.join(own, TOOL_SHELL_OOM_HOOK_FILE));
    assert.equal(fs.statSync(own).mode & 0o777, 0o700);
    if (process.getuid) assert.equal(ensureToolShellOomHook({ dir: own, uid: process.getuid() + 1 }), null, 'a directory owned by another user is not used');
    const shared = path.join(dir, 'shared');
    fs.mkdirSync(shared, { mode: 0o777 });
    fs.chmodSync(shared, 0o777);
    assert.equal(ensureToolShellOomHook({ dir: shared, uid: process.getuid?.() ?? 0 }), process.getuid ? null : path.join(shared, TOOL_SHELL_OOM_HOOK_FILE), 'a directory others can write to is not used');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('arming sets BASH_ENV, keeps an existing BASH_ENV in the chain, and is Linux only', () => {
  const env = { BASH_ENV: '/home/u/.bashenv' };
  const entries = armToolShellOomScoreAdj({ env, platform: 'linux', fs: memoryFs(), dir: '/tmp/h', launcherPid: 4242 });
  assert.deepEqual(entries, { BASH_ENV: path.join('/tmp/h', TOOL_SHELL_OOM_HOOK_FILE), HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ: '500', HIVE_MIND_OOM_SCORE_ADJ_LAUNCHER_PID: '4242', HIVE_MIND_PREVIOUS_BASH_ENV: '/home/u/.bashenv' });
  assert.equal(env.BASH_ENV, entries.BASH_ENV);
  // A nested solve re-arms with its own PID and keeps the original chain.
  const again = buildToolShellOomEnv(env, { hookPath: entries.BASH_ENV, launcherPid: 7 });
  assert.equal(again.HIVE_MIND_PREVIOUS_BASH_ENV, '/home/u/.bashenv');
  assert.equal(again.HIVE_MIND_OOM_SCORE_ADJ_LAUNCHER_PID, '7');
  assert.equal(armToolShellOomScoreAdj({ env: {}, platform: 'darwin', fs: memoryFs() }), null);
  assert.equal(armToolShellOomScoreAdj({ env: { HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ: 'off' }, platform: 'linux', fs: memoryFs() }), null);
});

function hasBash() {
  try {
    execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' });
    return fs.existsSync('/proc/self/oom_score_adj');
  } catch {
    return false;
  }
}

const own = hasBash() ? Number(fs.readFileSync('/proc/self/oom_score_adj', 'utf8')) : NaN;
const canRun = process.platform === 'linux' && Number.isFinite(own) && own < 500;

test('real bash: tool shells are raised, the launcher shell and the CLI are not', { skip: !canRun && 'needs Linux, bash and an oom_score_adj below 500' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-oom-3125-'));
  try {
    const previous = path.join(dir, 'previous.sh');
    fs.writeFileSync(previous, 'HIVE_MIND_TEST_CHAINED=yes\n');
    // SHLVL=1 as when solve runs from a shell. A top-level bash (SHLVL unset) whose
    // stdin is a socket, as node's stdio pipes are, takes the sshd path and skips BASH_ENV.
    const env = { PATH: process.env.PATH, HOME: dir, SHLVL: '1', BASH_ENV: previous };
    armToolShellOomScoreAdj({ env, platform: 'linux', dir, launcherPid: process.pid });
    // A stand-in AI CLI: a node process that runs each tool command with `bash -c`, like Claude Code's Bash tool.
    const cli = path.join(dir, 'fake-cli.cjs');
    fs.writeFileSync(cli, "const { execFileSync } = require('node:child_process');\nconst fs = require('node:fs');\nprocess.stdout.write(`cli=${fs.readFileSync('/proc/self/oom_score_adj', 'utf8').trim()} tool=${execFileSync('bash', process.argv.slice(2), { encoding: 'utf8' }).trim()}`);\n");
    // solve launches the CLI through a shell; here that launcher shell is bash, the risky case.
    const launch = (...toolArgs) => execFileSync('bash', ['-c', `"${process.execPath}" "${cli}" ${toolArgs.map(a => `'${a}'`).join(' ')}; true`], { env, encoding: 'utf8' }).trim();
    assert.equal(launch('-c', 'cat /proc/self/oom_score_adj'), `cli=${own} tool=500`, 'the tool shell is raised, the CLI keeps its score');
    assert.equal(launch('-c', 'sh -c "cat /proc/self/oom_score_adj"'), `cli=${own} tool=500`, 'commands the tool shell starts inherit the raised score');
    assert.equal(launch('-lc', 'cat /proc/self/oom_score_adj'), `cli=${own} tool=500`, 'login shells (codex runs bash -lc) read BASH_ENV too');
    assert.equal(launch('-c', 'echo $HIVE_MIND_TEST_CHAINED'), `cli=${own} tool=yes`, 'the previous BASH_ENV still runs');
    assert.equal(launch('-c', 'true'), `cli=${own} tool=`, 'the hook prints nothing');
    // Without the launcher guard the bash launcher would raise itself, and the CLI with it.
    const unguarded = { ...env, HIVE_MIND_OOM_SCORE_ADJ_LAUNCHER_PID: '' };
    assert.equal(execFileSync('bash', ['-c', `"${process.execPath}" "${cli}" -c true; true`], { env: unguarded, encoding: 'utf8' }).trim(), 'cli=500 tool=');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the hook is valid bash', { skip: !hasBash() && 'needs bash' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-oom-3125-'));
  try {
    const file = path.join(dir, 'hook.sh');
    fs.writeFileSync(file, buildToolShellOomHookScript());
    execFileSync('bash', ['-n', file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
