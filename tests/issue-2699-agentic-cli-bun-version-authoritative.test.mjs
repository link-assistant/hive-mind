/**
 * @hive-mind-test-suite default
 *
 * Issue #2699: every bot start reinstalled two CLIs that were already current,
 * then reported both updates as failed:
 *
 *   ⬆️ Updating claude-profiles 0.40.7 → 1.2.3
 *   ⬆️ Updating gh-setup-git-identity 0.1.0 → 0.8.0
 *   [VERBOSE] agentic-cli-updater: 0 updated, 11 current, 2 failed (claude-profiles: after install the binary reports 0.40.7; gh-setup-git-identity: after install the binary reports 0.1.0)
 *
 * Bun had 1.2.3 and 0.8.0 installed; only their `--version` output was wrong.
 * For Bun-installed targets, Bun's install list is now the authoritative version.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AGENTIC_CLI_TARGETS, describeBinaryVersionMismatch, inspectInstalledCli, readAgenticCliState, updateAgenticClisWhenIdle } from '../src/agentic-cli-updater.lib.mjs';

const makeEnv = extra => ({ HIVE_MIND_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'hive-issue-2699-cli-')), ...extra });
const target = id => AGENTIC_CLI_TARGETS.find(entry => entry.id === id);

// The production host: Bun's global inventory is current, both binaries lie.
const makeHost = ({ bunInventory, binaryOutput, published }) => {
  const commands = [];
  const run = async (command, args) => {
    commands.push([command, ...args].join(' '));
    if (args[0] === '--version') {
      if (!(command in binaryOutput)) throw new Error(`${command}: not found`);
      return { stdout: binaryOutput[command] };
    }
    if (command === 'bun' && args.join(' ') === 'pm ls -g')
      return {
        stdout: `/home/box/.bun/install/global node_modules (2 installed)\n${Object.entries(bunInventory.current)
          .map(([name, version]) => `├── ${name}@${version}`)
          .join('\n')}\n`,
      };
    if (command === 'npm') return { stdout: `${published[args[1]]}\n` };
    if (command === 'bun' && args[0] === 'install') {
      const spec = args[2].replace(/@latest$/, '');
      bunInventory.current[spec] = published[spec];
      return { stdout: 'installed' };
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };
  return { run, commands };
};

const productionHost = () =>
  makeHost({
    bunInventory: { current: { '@link-assistant/claude-profiles': '1.2.3', 'gh-setup-git-identity': '0.8.0' } },
    binaryOutput: { 'claude-profiles': '0.40.7\n', 'gh-setup-git-identity': '0.1.0\n' },
    published: { '@link-assistant/claude-profiles': '1.2.3', 'gh-setup-git-identity': '0.8.0' },
  });

test('Bun inventory wins over a wrong --version for Bun-installed CLIs', async () => {
  const { run } = productionHost();
  assert.deepEqual(await inspectInstalledCli(target('claude-profiles'), { run }), { version: '1.2.3', source: 'bun', binaryVersion: '0.40.7' });
  assert.deepEqual(await inspectInstalledCli(target('gh-setup-git-identity'), { run }), { version: '0.8.0', source: 'bun', binaryVersion: '0.1.0' });
});

test('a package Bun does not list falls back to its --version', async () => {
  const run = async (command, args) => {
    if (args[0] === '--version') return { stdout: 'codex-cli 0.9.0\n' };
    if (command === 'bun') return { stdout: '/home/box/.bun/install/global node_modules (0 installed)\n' };
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };
  assert.deepEqual(await inspectInstalledCli(target('codex'), { run }), { version: '0.9.0', source: 'binary', binaryVersion: '0.9.0' });
});

test('self-updating CLIs keep --version as the primary source and never ask Bun when it answers', async () => {
  const commands = [];
  const run = async (command, args) => {
    commands.push([command, ...args].join(' '));
    if (args[0] === '--version') return { stdout: '2.1.0 (Claude Code)\n' };
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };
  assert.deepEqual(await inspectInstalledCli(target('claude'), { run }), { version: '2.1.0', source: 'binary', binaryVersion: '2.1.0' });
  assert.deepEqual(commands, ['claude --version']);
});

test('the mismatch note names the upstream bug', () => {
  assert.equal(describeBinaryVersionMismatch(target('claude-profiles'), { version: '1.2.3', source: 'bun', binaryVersion: '0.40.7' }), 'claude-profiles: `claude-profiles --version` reports 0.40.7, but Bun has @link-assistant/claude-profiles@1.2.3 installed; trusting Bun (upstream bug: https://github.com/link-assistant/claude-profiles/issues/57)');
  assert.equal(describeBinaryVersionMismatch(target('gh-upload-log'), { version: '0.10.1', source: 'bun', binaryVersion: '0.10.0' }), 'gh-upload-log: `gh-upload-log --version` reports 0.10.0, but Bun has gh-upload-log@0.10.1 installed; trusting Bun');
  assert.equal(describeBinaryVersionMismatch(target('gh-upload-log'), { version: '0.10.1', source: 'bun', binaryVersion: '0.10.1' }), null);
  assert.equal(describeBinaryVersionMismatch(target('gh-upload-log'), { version: '0.10.1', source: 'bun', binaryVersion: null }), null, 'a broken entry point (gh-load-issue@0.3.2) is not a wrong --version');
  assert.equal(describeBinaryVersionMismatch(target('codex'), { version: '0.9.0', source: 'binary', binaryVersion: '0.9.0' }), null);
});

test('current CLIs with a wrong --version are neither reinstalled nor counted as failed, and the mismatch is logged once', async () => {
  const env = makeEnv({ HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'claude-profiles,gh-setup-git-identity' });
  try {
    const { run, commands } = productionHost();
    const logged = [];
    const result = await updateAgenticClisWhenIdle({ env, run, verbose: true, force: true, log: async line => logged.push(line), getActiveTasksImpl: async () => [] });

    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.updated, []);
    assert.deepEqual(result.upToDate, [
      { id: 'claude-profiles', version: '1.2.3' },
      { id: 'gh-setup-git-identity', version: '0.8.0' },
    ]);
    assert.equal(
      commands.some(command => command.startsWith('bun install')),
      false,
      commands.join('\n')
    );
    assert.equal(
      logged.some(line => line.startsWith('⬆️')),
      false,
      logged.join('\n')
    );
    assert.deepEqual(
      logged.filter(line => line.startsWith('ℹ️')),
      ['ℹ️ claude-profiles: `claude-profiles --version` reports 0.40.7, but Bun has @link-assistant/claude-profiles@1.2.3 installed; trusting Bun (upstream bug: https://github.com/link-assistant/claude-profiles/issues/57)', 'ℹ️ gh-setup-git-identity: `gh-setup-git-identity --version` reports 0.1.0, but Bun has gh-setup-git-identity@0.8.0 installed; trusting Bun (upstream bug: https://github.com/link-foundation/gh-setup-git-identity/issues/30)']
    );
    assert.equal(logged.at(-1), '[VERBOSE] agentic-cli-updater: 0 updated, 2 current, 0 failed');
    assert.equal(readAgenticCliState({ env }).tools['claude-profiles'].binaryReports, '0.40.7');

    // The next start (a new process, same state dir) does not repeat the note.
    const again = [];
    await updateAgenticClisWhenIdle({ env, run: productionHost().run, verbose: true, force: true, log: async line => again.push(line), getActiveTasksImpl: async () => [] });
    assert.deepEqual(
      again.filter(line => line.startsWith('ℹ️')),
      [],
      again.join('\n')
    );

    // Once upstream fixes --version, the remembered mismatch is cleared.
    const fixed = makeHost({
      bunInventory: { current: { '@link-assistant/claude-profiles': '1.2.3', 'gh-setup-git-identity': '0.8.0' } },
      binaryOutput: { 'claude-profiles': '1.2.3\n', 'gh-setup-git-identity': '0.8.0\n' },
      published: { '@link-assistant/claude-profiles': '1.2.3', 'gh-setup-git-identity': '0.8.0' },
    });
    await updateAgenticClisWhenIdle({ env, run: fixed.run, force: true, getActiveTasksImpl: async () => [] });
    assert.equal('binaryReports' in readAgenticCliState({ env }).tools['claude-profiles'], false);
  } finally {
    fs.rmSync(env.HIVE_MIND_STATE_DIR, { recursive: true, force: true });
  }
});

test('a real update is verified against Bun, so a wrong --version does not fail it', async () => {
  const env = makeEnv({ HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'gh-setup-git-identity' });
  try {
    const { run, commands } = makeHost({
      bunInventory: { current: { 'gh-setup-git-identity': '0.7.0' } },
      binaryOutput: { 'gh-setup-git-identity': '0.1.0\n' },
      published: { 'gh-setup-git-identity': '0.8.0' },
    });
    const logged = [];
    const result = await updateAgenticClisWhenIdle({ env, run, force: true, log: async line => logged.push(line), getActiveTasksImpl: async () => [] });

    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.updated, [{ id: 'gh-setup-git-identity', from: '0.7.0', to: '0.8.0' }]);
    assert.ok(logged.includes('⬆️ Updating gh-setup-git-identity 0.7.0 → 0.8.0'), logged.join('\n'));
    assert.ok(commands.includes('bun install -g gh-setup-git-identity@latest'));
    const entry = readAgenticCliState({ env }).tools['gh-setup-git-identity'];
    assert.equal(entry.version, '0.8.0');
    assert.equal(entry.previousVersion, '0.7.0');
    assert.equal(entry.binaryReports, '0.1.0');
  } finally {
    fs.rmSync(env.HIVE_MIND_STATE_DIR, { recursive: true, force: true });
  }
});

test("an install that leaves Bun's list unchanged still fails, and says Bun reported it", async () => {
  const env = makeEnv({ HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'gh-upload-log' });
  try {
    const run = async (command, args) => {
      if (args[0] === '--version') return { stdout: '0.10.0\n' };
      if (command === 'bun' && args.join(' ') === 'pm ls -g') return { stdout: '└── gh-upload-log@0.10.0\n' };
      if (command === 'npm') return { stdout: '0.10.1\n' };
      if (command === 'bun' && args[0] === 'install') return { stdout: 'installed' };
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    };
    const result = await updateAgenticClisWhenIdle({ env, run, force: true, getActiveTasksImpl: async () => [] });
    assert.deepEqual(result.failed, [{ id: 'gh-upload-log', installed: '0.10.0', latest: '0.10.1', error: "after install Bun's install list reports 0.10.0" }]);
  } finally {
    fs.rmSync(env.HIVE_MIND_STATE_DIR, { recursive: true, force: true });
  }
});
