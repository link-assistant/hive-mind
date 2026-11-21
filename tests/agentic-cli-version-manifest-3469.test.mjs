/**
 * @hive-mind-test-suite default
 *
 * Issue #3469: the bot log (docs/case-studies/issue-3469/data/telegram-bot.log.txt) said
 *
 *   ⚠️ Could not update claude-profiles: after install the binary reports 0.40.8 (expected 1.2.3)
 *   ⚠️ Could not update gh-setup-git-identity: after install the binary reports 0.1.0 (expected 0.8.0)
 *
 * Both installs had succeeded: gh-setup-git-identity@0.8.0 hard-codes
 * `.version('0.1.0')` and claude-profiles@1.2.3 prints nvm's own version, so
 * every idle check reinstalled them and reported a failure. The package.json
 * that owns the binary on PATH is the version that was installed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readBinaryPackageVersion, updateAgenticClisWhenIdle } from '../src/agentic-cli-updater.lib.mjs';

/** A Bun-style global install: bin/<name> links to node_modules/<package>/<entry>. */
const makeInstall = (root, { binary, packageName, version, entry }) => {
  const packageDir = path.join(root, 'install', 'global', 'node_modules', ...packageName.split('/'));
  fs.mkdirSync(path.join(packageDir, path.dirname(entry)), { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: packageName, version }));
  fs.writeFileSync(path.join(packageDir, entry), '#!/usr/bin/env node\n');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.symlinkSync(path.join(packageDir, entry), path.join(root, 'bin', binary));
  return packageDir;
};

const withHost = async fn => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-3469-cli-manifest-'));
  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('the manifest that owns the binary wins over a CLI that misreports its version', async () => {
  await withHost(async root => {
    const versions = { '@link-assistant/claude-profiles': '0.40.7', 'gh-setup-git-identity': '0.1.0' };
    const dirs = {
      '@link-assistant/claude-profiles': makeInstall(root, { binary: 'claude-profiles', packageName: '@link-assistant/claude-profiles', version: versions['@link-assistant/claude-profiles'], entry: 'claude-profiles.mjs' }),
      'gh-setup-git-identity': makeInstall(root, { binary: 'gh-setup-git-identity', packageName: 'gh-setup-git-identity', version: versions['gh-setup-git-identity'], entry: 'src/cli.js' }),
    };
    const published = { '@link-assistant/claude-profiles': '1.2.3', 'gh-setup-git-identity': '0.8.0' };
    const misreported = { 'claude-profiles': '0.40.8', 'gh-setup-git-identity': '0.1.0' };
    const installs = [];
    const run = async (command, args) => {
      if (args[0] === '--version') return { stdout: `${misreported[command]}\n` };
      if (command === 'npm') return { stdout: `${published[args[1]]}\n` };
      if (command === 'bun' && args[0] === 'install') {
        const name = args[2].replace(/@latest$/, '');
        installs.push(name);
        fs.writeFileSync(path.join(dirs[name], 'package.json'), JSON.stringify({ name, version: published[name] }));
        return { stdout: 'installed' };
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    };
    const env = { PATH: path.join(root, 'bin'), HIVE_MIND_STATE_DIR: path.join(root, 'state'), HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'claude-profiles,gh-setup-git-identity' };
    const logged = [];
    const first = await updateAgenticClisWhenIdle({ env, run, verbose: true, log: async line => logged.push(line), getActiveTasksImpl: async () => [] });
    assert.deepEqual(first.failed, [], logged.join('\n'));
    assert.deepEqual(
      first.updated.map(entry => `${entry.id} ${entry.from}→${entry.to}`),
      ['claude-profiles 0.40.7→1.2.3', 'gh-setup-git-identity 0.1.0→0.8.0']
    );
    assert.ok(!logged.some(line => line.startsWith('⚠️')), logged.join('\n'));
    assert.ok(
      logged.some(line => line.includes('claude-profiles 1.2.3 (from ') && line.endsWith(`${path.sep}package.json)`)),
      'verbose mode names the evidence'
    );

    // The next idle check must not reinstall what is already current.
    const second = await updateAgenticClisWhenIdle({ env, run, force: true, getActiveTasksImpl: async () => [] });
    assert.deepEqual(
      second.upToDate.map(entry => entry.id),
      ['claude-profiles', 'gh-setup-git-identity']
    );
    assert.equal(installs.length, 2);
  });
});

test('an older copy earlier on PATH is reported, not mistaken for the update', async () => {
  await withHost(async root => {
    const shadow = path.join(root, 'shadow');
    makeInstall(shadow, { binary: 'gh-upload-log', packageName: 'gh-upload-log', version: '0.1.0', entry: 'src/cli.js' });
    makeInstall(root, { binary: 'gh-upload-log', packageName: 'gh-upload-log', version: '0.9.0', entry: 'src/cli.js' });
    const owner = await readBinaryPackageVersion({ binary: 'gh-upload-log', package: 'gh-upload-log' }, { env: { PATH: [path.join(shadow, 'bin'), path.join(root, 'bin')].join(path.delimiter) } });
    assert.equal(owner.version, '0.1.0');
  });
});

test('a binary outside any matching package (a native installer) falls back to --version', async () => {
  await withHost(async root => {
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin', 'claude'), '#!/bin/sh\n');
    assert.equal(await readBinaryPackageVersion({ binary: 'claude', package: '@anthropic-ai/claude-code' }, { env: { PATH: path.join(root, 'bin') } }), null);
    assert.equal(await readBinaryPackageVersion({ binary: 'claude', package: '@anthropic-ai/claude-code' }, { env: {} }), null);
  });
});

test('the git identity repair hint names the published package', () => {
  // `npm install -g @link-foundation/gh-setup-git-identity` is a 404: the package is unscoped.
  const source = fs.readFileSync(new URL('../src/solve.validation.lib.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('@link-foundation/gh-setup-git-identity'));
  assert.ok(source.includes('npm install -g gh-setup-git-identity'));
});
