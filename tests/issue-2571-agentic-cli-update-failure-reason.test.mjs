/**
 * @hive-mind-test-suite default
 *
 * Issue #2571: the production log showed
 *
 *   ⬆️ Updating claude-profiles 0.40.7 → 1.2.3
 *   ⬆️ Updating gh-setup-git-identity 0.1.0 → 0.8.0
 *   [VERBOSE] agentic-cli-updater: 0 updated, 11 current, 2 failed
 *
 * and nothing else: `bun install -g` exited 0, so only the post-install version
 * check knew why the update failed, and it logged nothing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { updateAgenticClisWhenIdle } from '../src/agentic-cli-updater.lib.mjs';

const makeEnv = extra => ({ HIVE_MIND_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'hive-issue-2571-cli-')), ...extra });

test('a post-install version mismatch and an unreachable registry both say why they failed', async () => {
  const installed = { 'claude-profiles': '0.40.7', 'gh-setup-git-identity': '0.1.0' };
  const published = { '@link-assistant/claude-profiles': '1.2.3', 'gh-setup-git-identity': null };
  const run = async (command, args) => {
    if (args[0] === '--version') return { stdout: `${installed[command]}\n` };
    if (command === 'npm') {
      if (!published[args[1]]) throw new Error('npm ERR! network');
      return { stdout: `${published[args[1]]}\n` };
    }
    // The installer succeeds but the binary on PATH keeps reporting the old version.
    if (command === 'bun' && args[0] === 'install') return { stdout: 'installed' };
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };
  const env = makeEnv({ HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'claude-profiles,gh-setup-git-identity' });
  const logged = [];
  try {
    const result = await updateAgenticClisWhenIdle({ env, run, verbose: true, log: async line => logged.push(line), getActiveTasksImpl: async () => [] });
    assert.equal(result.failed.length, 2);
    assert.ok(logged.includes('⚠️ Could not update claude-profiles: after install the binary reports 0.40.7 (expected 1.2.3)'), logged.join('\n'));
    assert.ok(logged.includes('[VERBOSE] agentic-cli-updater: gh-setup-git-identity: could not read the published version of gh-setup-git-identity'), logged.join('\n'));
    assert.equal(logged.at(-1), '[VERBOSE] agentic-cli-updater: 0 updated, 0 current, 2 failed (claude-profiles: after install the binary reports 0.40.7; gh-setup-git-identity: could not read the published version of gh-setup-git-identity)');
  } finally {
    fs.rmSync(env.HIVE_MIND_STATE_DIR, { recursive: true, force: true });
  }
});
