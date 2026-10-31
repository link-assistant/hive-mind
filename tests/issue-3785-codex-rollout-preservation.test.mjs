/** @hive-mind-test-suite default */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { shareScopedCodexSessions } from '../src/codex-sessions.lib.mjs';
import { restoreCodexRolloutFromContainer } from '../src/session-kill-resume.fresh-session.lib.mjs';
import { publishCodexRollout } from '../src/codex-rollout-publication.lib.mjs';

for (const crossDevice of [false, true]) {
  test(`legacy rollout migration preserves a concurrent canonical writer (${crossDevice ? 'cross-device' : 'same-device'})`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-rollout-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const base = path.join(root, 'canonical');
    const scoped = path.join(root, 'old-task');
    const name = 'rollout-2026-10-26T00-00-00-thread-3785.jsonl';
    const source = path.join(scoped, 'sessions', name);
    const target = path.join(base, 'sessions', name);
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(source, 'recovered task evidence\n');
    let raced = false;
    const io = { ...fs };
    for (const method of ['rename', 'link', 'copyFile']) {
      io[method] = async (from, to, ...args) => {
        if (crossDevice && from === source && ['rename', 'link'].includes(method)) throw Object.assign(new Error('different mounts'), { code: 'EXDEV' });
        if (to === target && !raced) {
          raced = true;
          await fs.writeFile(target, 'new canonical conversation\n');
        }
        return fs[method](from, to, ...args);
      };
    }
    const outcome = await shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped, fsImpl: io, now: () => 3785 });
    assert.equal(raced, true, 'the writer must race the actual publication operation');
    assert.equal(await fs.readFile(target, 'utf8'), 'new canonical conversation\n');
    assert.equal(outcome.status, 'shared');
    assert.equal(outcome.kept, 1);
    assert.equal(outcome.migrated, 0);
    assert.equal(await fs.readFile(path.join(scoped, 'sessions.pre-issue-2888-3785', name), 'utf8'), 'recovered task evidence\n');
    assert.deepEqual(await fs.readdir(path.dirname(target)), [name], 'publication scratch files must be removed');
  });
}

test('container recovery keeps a concurrent canonical rollout and retains the recovered conflict', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const hostSessionsDir = path.join(root, 'sessions');
  const threadId = 'thread-3785';
  const name = `rollout-2026-10-26T00-00-00-${threadId}.jsonl`;
  const target = path.join(hostSessionsDir, name);
  let raced = false;
  const io = { ...fs };
  for (const method of ['link', 'copyFile']) {
    io[method] = async (from, to, ...args) => {
      if (to === target && !raced) {
        raced = true;
        await fs.writeFile(target, 'new canonical conversation\n');
      }
      return fs[method](from, to, ...args);
    };
  }
  const result = await restoreCodexRolloutFromContainer({
    containerName: 'stopped-task',
    sessionInfo: { url: 'https://github.com/link-assistant/hive-mind/issues/3785' },
    threadId,
    hostSessionsDir,
    fsImpl: io,
    tmpDir: root,
    runner: {
      copyFromDockerContainer: async (_container, _source, destination) => {
        await fs.writeFile(path.join(destination, name), 'recovered task evidence\n');
        return { success: true };
      },
    },
  });
  assert.equal(raced, true);
  assert.equal(await fs.readFile(target, 'utf8'), 'new canonical conversation\n');
  assert.equal(result.restored, true);
  assert.equal(result.file, target);
  assert.ok(result.conflictFile, 'retain conflicting evidence before removing docker-cp staging');
  assert.equal(await fs.readFile(result.conflictFile, 'utf8'), 'recovered task evidence\n');
  assert.equal((await fs.stat(result.conflictFile)).mode & 0o777, 0o600);
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(result.conflictFile), 'metadata.json'), 'utf8'));
  assert.equal(metadata.requestedName, name);
});

test('a linked canonical destination is refused while recovered evidence remains durable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-link-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'stopped-rollout');
  const outside = path.join(root, 'unrelated');
  const target = path.join(root, 'rollout.jsonl');
  await fs.writeFile(source, 'recovered evidence');
  await fs.writeFile(outside, 'unrelated data');
  await fs.symlink(outside, target);
  let failure;
  await assert.rejects(publishCodexRollout({ source, target, retainConflict: true }), error => {
    failure = error;
    return /not a regular file/u.test(error.message);
  });
  assert.equal(await fs.readFile(outside, 'utf8'), 'unrelated data');
  assert.equal(await fs.readFile(failure.conflictFile, 'utf8'), 'recovered evidence');
});

test('recovery exposes the native rollout name only after copying has finished', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'stopped-rollout');
  const target = path.join(root, 'rollout.jsonl');
  await fs.writeFile(source, 'complete recovered evidence');
  let observedCopy = false;
  const fsImpl = {
    ...fs,
    copyFile: async (from, to, flags) => {
      observedCopy = true;
      await fs.writeFile(to, 'partial');
      await assert.rejects(fs.access(target), { code: 'ENOENT' });
      await fs.rm(to);
      return fs.copyFile(from, to, flags);
    },
  };
  assert.equal((await publishCodexRollout({ source, target, fsImpl })).published, true);
  assert.equal(observedCopy, true);
  assert.equal(await fs.readFile(target, 'utf8'), 'complete recovered evidence');
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(source, 'utf8'), 'complete recovered evidence');
  assert.deepEqual((await fs.readdir(root)).sort(), ['rollout.jsonl', 'stopped-rollout']);
});
