/** @hive-mind-test-suite default */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { shareScopedCodexSessions, createCodexResumeRolloutCheck } from '../src/codex-sessions.lib.mjs';
import { getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { restoreCodexRolloutFromContainer, resolveFreshRecoveryCommand, FRESH_RESUME_OUTCOMES } from '../src/session-kill-resume.fresh-session.lib.mjs';

const threadId = '019f2a1b-0000-7000-8000-000000003785';
const name = `rollout-2026-10-26T00-00-00-${threadId}.jsonl`;
const url = 'https://github.com/link-assistant/hive-mind/issues/3785';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, base: path.join(root, '.codex'), first: path.join(root, 'first'), second: path.join(root, 'second') };
}

test('independent Codex configurations share native archives and one writer-lock namespace', async t => {
  const { base, first, second } = await fixture(t);
  for (const codexHome of [first, second]) assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome })).status, 'shared');
  for (const directory of ['sessions', 'archived_sessions', 'thread-writer-locks']) {
    assert.equal(await fs.realpath(path.join(first, directory)), await fs.realpath(path.join(base, directory)));
    assert.equal(await fs.realpath(path.join(second, directory)), await fs.realpath(path.join(base, directory)));
  }
  const source = path.join(first, 'sessions', name);
  await fs.writeFile(source, 'prior conversation');
  await fs.rename(source, path.join(first, 'archived_sessions', name));
  assert.equal(await fs.readFile(path.join(second, 'archived_sessions', name), 'utf8'), 'prior conversation');
  await fs.writeFile(path.join(first, 'thread-writer-locks', `${threadId}.lock`), 'native lock');
  const owner = await fs.stat(path.join(base, 'thread-writer-locks', `${threadId}.lock`));
  const peer = await fs.stat(path.join(second, 'thread-writer-locks', `${threadId}.lock`));
  assert.equal(peer.ino, owner.ino);
  assert.equal(peer.dev, owner.dev);
});

test('existing private native lock directories refuse projection without moving a live lock', async t => {
  const { base, first } = await fixture(t);
  const directory = path.join(first, 'thread-writer-locks');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${threadId}.lock`);
  await fs.writeFile(file, 'active writer evidence');
  const before = await fs.stat(file);
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome: first })).status, 'failed');
  assert.equal((await fs.stat(file)).ino, before.ino);
  assert.equal(await fs.readFile(file, 'utf8'), 'active writer evidence');
});

test('linked canonical archive destinations refuse history projection', async t => {
  const { root, base, first } = await fixture(t);
  const foreign = path.join(root, 'foreign');
  await fs.mkdir(base);
  await fs.mkdir(foreign);
  await fs.symlink(foreign, path.join(base, 'archived_sessions'));
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome: first })).status, 'failed');
  assert.deepEqual(await fs.readdir(foreign), []);
});

test('Docker tasks mount native archives and writer locks from host-backed parent storage', async t => {
  const { root } = await fixture(t);
  const prepared = await prepareDockerIsolationHostPaths({ tool: 'codex', homeDir: root, env: {} });
  const mounts = await getDockerIsolationAuthMounts({
    tool: 'codex',
    homeDir: root,
    env: {},
    existsSync: async file =>
      fs.access(file).then(
        () => true,
        () => false
      ),
  });
  for (const directory of ['archived_sessions', 'thread-writer-locks']) {
    const source = path.join(root, '.codex', directory);
    assert.ok(prepared.created.includes(source));
    assert.ok(mounts.some(mount => mount.source === source && mount.target === `/home/box/.codex/${directory}`));
  }
  const routed = await getDockerIsolationAuthMounts({ tool: 'codex', homeDir: root, env: {}, existsSync: () => true, useRouter: true });
  assert.equal(
    routed.some(mount => mount.target.startsWith('/home/box/.codex')),
    false
  );
});

test('fresh recovery and execution retain resume for a canonical archived rollout', async t => {
  const { root, base } = await fixture(t);
  await fs.mkdir(path.join(base, 'archived_sessions'), { recursive: true });
  await fs.writeFile(path.join(base, 'archived_sessions', name), 'archived conversation');
  assert.equal(await createCodexResumeRolloutCheck()({ threadId, codexHome: base, log: async () => {} }), true);
  const command = { commandName: 'solve', args: [url, '--tool', 'codex', '--resume', threadId] };
  const result = await resolveFreshRecoveryCommand({ sessionName: 'stopped', sessionInfo: { url, tool: 'codex', isolationBackend: 'docker' }, command, runner: {}, homeDir: root });
  assert.equal(result.outcome, FRESH_RESUME_OUTCOMES.KEPT);
  assert.deepEqual(result.command, command);
});

test('stopped-container recovery preserves native archived location', async t => {
  const { root, base } = await fixture(t);
  const result = await restoreCodexRolloutFromContainer({
    containerName: 'stopped',
    sessionInfo: { url },
    threadId,
    hostSessionsDir: path.join(base, 'sessions'),
    tmpDir: root,
    runner: {
      copyFromDockerContainer: async (_container, source, destination) => {
        if (source !== '/home/box/.codex/archived_sessions/.') return { success: false };
        await fs.writeFile(path.join(destination, name), 'recovered archived conversation');
        return { success: true };
      },
    },
  });
  assert.equal(result.restored, true);
  assert.equal(result.file, path.join(base, 'archived_sessions', name));
  assert.equal(await fs.readFile(result.file, 'utf8'), 'recovered archived conversation');
});

test('unavailable canonical history refuses Docker preparation and mount selection', async t => {
  const { root } = await fixture(t);
  await assert.rejects(getDockerIsolationAuthMounts({ tool: 'codex', homeDir: root, env: {}, existsSync: () => false }), /history.*unavailable/iu);
  const io = {
    promises: {
      ...fs,
      mkdir: async () => {
        throw Object.assign(new Error('read-only'), { code: 'EROFS' });
      },
    },
  };
  await assert.rejects(prepareDockerIsolationHostPaths({ tool: 'codex', homeDir: root, env: {}, fsImpl: io }), /history.*unavailable/iu);
});

test('linked canonical history refuses Docker preparation without modifying its target', async t => {
  const { root, base } = await fixture(t);
  const foreign = path.join(root, 'foreign');
  await fs.mkdir(foreign);
  await fs.mkdir(base);
  await fs.symlink(foreign, path.join(base, 'sessions'));
  await assert.rejects(prepareDockerIsolationHostPaths({ tool: 'codex', homeDir: root, env: {} }), /history.*unavailable/iu);
  assert.deepEqual(await fs.readdir(foreign), []);
});
