/** @hive-mind-test-suite default */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findCodexRolloutFile, isCodexRolloutFileName } from '../src/codex-sessions.lib.mjs';
import { restoreCodexRolloutFromContainer } from '../src/session-kill-resume.fresh-session.lib.mjs';

const threadId = '019f2a1b-0000-7000-8000-000000003785';
const rolloutId = '019f2a1b-0000-7000-8000-000000003786';
const prefix = 'rollout-2026-10-26T00-00-00-';

for (const suffix of ['.jsonl', '.jsonl.zst', `_${rolloutId}.jsonl`, `_${rolloutId}.jsonl.zst`]) {
  test(`preserve native Codex rollout identity for ${suffix}`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-format-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const name = `${prefix}${threadId}${suffix}`;
    assert.equal(isCodexRolloutFileName(name, threadId), true);
    assert.equal(isCodexRolloutFileName(name, rolloutId), false, 'a reverted rollout id is not its stable thread id');
    const sessionsDir = path.join(root, 'sessions');
    await fs.mkdir(sessionsDir);
    const bytes = Buffer.from('opaque native rollout bytes');
    const restored = await restoreCodexRolloutFromContainer({
      containerName: 'stopped-task',
      sessionInfo: { url: 'https://github.com/link-assistant/hive-mind/issues/3785' },
      threadId,
      hostSessionsDir: sessionsDir,
      tmpDir: root,
      runner: {
        copyFromDockerContainer: async (_container, _source, destination) => {
          await fs.writeFile(path.join(destination, name), bytes);
          return { success: true };
        },
      },
    });
    assert.equal(restored.restored, true);
    assert.equal(restored.file, path.join(sessionsDir, name));
    assert.deepEqual(await fs.readFile(restored.file), bytes);
    assert.equal(await findCodexRolloutFile({ sessionsDir, threadId }), restored.file);
  });
}

test('rollout discovery refuses lookalike identifiers and unsupported encodings', () => {
  for (const suffix of ['.jsonl.zst.tmp', '.jsonl.gz', '_not-a-rollout.jsonl', '_../escape.jsonl', `.extra.jsonl`, `${rolloutId}.jsonl`]) assert.equal(isCodexRolloutFileName(`${prefix}${threadId}${suffix}`, threadId), false, suffix);
});
