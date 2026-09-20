#!/usr/bin/env node

/**
 * Regression coverage for issue #2264: dependency freshness is enforced before
 * merge, every version surface is inventoried, and long-lived containers can
 * refresh operational CLIs while idle.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AGENTIC_CLI_TARGETS, parseBunGlobalPackageVersion, updateAgenticClisWhenIdle } from '../src/agentic-cli-updater.lib.mjs';
import { assessVersionPin, checkDependencyRecords, collectDependencyRecords, parseGitHubActionPins, parseNpmPackagePins, resolveGitHubLatest } from '../scripts/dependency-freshness.lib.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

// Version declarations are compared with the precision they promise. A moving
// major action ref tracks patches automatically, while package ranges still
// need their lower bound moved so the lockfile cannot preserve an old release.
assert.equal(assessVersionPin({ current: '^1.2.0', latest: '1.3.0', policy: 'exact' }).current, false);
assert.equal(assessVersionPin({ current: 'v7', latest: 'v7.2.1', policy: 'major' }).current, true);
assert.equal(assessVersionPin({ current: 'v6', latest: 'v7.2.1', policy: 'major' }).current, false);
assert.equal(assessVersionPin({ current: '1.98', latest: '1.98.1', policy: 'minor' }).current, true);

assert.equal(
  await resolveGitHubLatest(
    'owner/action',
    {},
    {
      fetchImpl: async () => ({
        ok: true,
        json: async () => [{ name: 'v8.0.0-beta.1' }, { name: 'v7.2.1' }],
      }),
    }
  ),
  'v7.2.1',
  'pre-release tags do not make stable dependency declarations stale'
);

assert.deepEqual(
  parseGitHubActionPins('steps:\n  - uses: actions/checkout@v7\n  - uses: zizmorcore/zizmor-action@v0.6.2\n  - uses: ./local-action\n', 'fixture.yml').map(record => [record.name, record.current, record.policy]),
  [
    ['actions/checkout', 'v7', 'major'],
    ['zizmorcore/zizmor-action', 'v0.6.2', 'exact'],
  ]
);

assert.deepEqual(
  parseNpmPackagePins('RUN bun install -g @link-assistant/agent@0.26.3 gh-upload-log@0.8.2\n', 'Dockerfile').map(record => [record.name, record.current]),
  [
    ['@link-assistant/agent', '0.26.3'],
    ['gh-upload-log', '0.8.2'],
  ]
);

{
  const result = await checkDependencyRecords(
    [
      { kind: 'npm', name: 'current-package', current: '^2.1.0', policy: 'exact', location: 'package.json' },
      { kind: 'npm', name: 'stale-package', current: '1.0.0', policy: 'exact', location: 'Dockerfile' },
      { kind: 'github', name: 'owner/action', current: 'v3', policy: 'major', location: 'workflow.yml' },
    ],
    {
      resolveNpmLatest: async name => ({ 'current-package': '2.1.0', 'stale-package': '1.2.0' })[name],
      resolveGitHubLatest: async () => 'v3.4.5',
    }
  );

  assert.deepEqual(
    result.stale.map(record => record.name),
    ['stale-package']
  );
  assert.equal(result.current.length, 2);
  assert.deepEqual(result.errors, []);
}

const repositoryRecords = await collectDependencyRecords({ root: repositoryRoot });
assert.equal(
  repositoryRecords.some(record => record.kind === 'npm' && record.name === '@sentry/node'),
  true,
  'package.json dependencies are checked'
);
assert.equal(
  repositoryRecords.some(record => record.kind === 'npm' && record.name === 'command-stream'),
  true,
  'runtime use-m pins are checked'
);
assert.equal(
  repositoryRecords.some(record => record.kind === 'github' && record.name === 'actions/checkout'),
  true,
  'workflow actions are checked'
);
assert.equal(
  repositoryRecords.some(record => record.kind === 'github' && record.name === 'helm/helm'),
  true,
  'tool versions embedded in workflows are checked'
);
assert.equal(
  repositoryRecords.some(record => record.kind === 'github' && record.name === 'link-foundation/box'),
  true,
  'container base releases are checked'
);
assert.equal(
  repositoryRecords.some(record => record.kind === 'github' && record.name === 'link-assistant/formal-ai'),
  true,
  'embedded Formal AI builds are checked'
);
assert.equal(
  repositoryRecords.some(record => record.kind === 'github' && record.name === 'oven-sh/bun'),
  true,
  'embedded Bun builds are checked'
);
assert.equal(
  repositoryRecords.some(record => record.kind === 'github' && record.name === 'nodejs/node' && record.versionMajor === 24),
  true,
  'the selected Node LTS line is checked'
);
assert.equal(
  repositoryRecords.some(record => record.kind === 'npm' && record.name === 'use-m'),
  true,
  'the runtime loader bootstrap is checked'
);

// Dependabot opens one coordinated PR across every dependency surface it
// supports. The custom gate covers the declarations Dependabot cannot update.
const dependabot = fs.readFileSync(path.join(repositoryRoot, '.github', 'dependabot.yml'), 'utf8');
for (const ecosystem of ['npm', 'github-actions', 'docker', 'docker-compose', 'helm']) {
  assert.match(dependabot, new RegExp(`package-ecosystem: ["']?${ecosystem}["']?`), `${ecosystem} updates must be configured`);
}
assert.match(dependabot, /multi-ecosystem-groups:/);
assert.match(dependabot, /interval: daily/);

const releaseWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
assert.match(releaseWorkflow, /node scripts\/check-dependency-freshness\.mjs/);
assert.match(releaseWorkflow, /detect-changes:[\s\S]*node scripts\/check-dependency-freshness\.mjs[\s\S]*node scripts\/detect-code-changes\.mjs/, 'the required detector rejects stale declarations before it publishes outputs');
assert.match(releaseWorkflow, /pipeline-status:[\s\S]*needs:[\s\S]*- detect-changes/, 'the terminal status gate observes freshness failures');

// Build-time `@latest` is not enough for a container that can live for months:
// maintenance must refresh operational utilities with the same idle lock used
// for agent CLIs.
const targetPackages = AGENTIC_CLI_TARGETS.map(target => target.package);
for (const packageName of ['@link-assistant/claude-profiles', 'gh-setup-git-identity', 'gh-pull-all', 'gh-load-issue', 'gh-load-pull-request', 'gh-upload-log']) {
  assert.equal(targetPackages.includes(packageName), true, `${packageName} must be refreshed in a running container`);
}

{
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-dependency-refresh-'));
  const env = { HIVE_MIND_STATE_DIR: stateDir, HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'gh-upload-log' };
  let installed = '0.1.0';
  const commands = [];
  const run = async (command, args) => {
    commands.push([command, ...args].join(' '));
    if (command === 'gh-upload-log' && args[0] === '--version') return { stdout: `gh-upload-log ${installed}\n` };
    if (command === 'npm') return { stdout: '0.9.1\n' };
    if (command === 'bun') {
      installed = '0.9.1';
      return { stdout: 'installed' };
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };

  const result = await updateAgenticClisWhenIdle({ env, run, force: true, getActiveTasksImpl: async () => [] });
  assert.deepEqual(result.updated, [{ id: 'gh-upload-log', from: '0.1.0', to: '0.9.1' }]);
  assert.equal(commands.includes('bun install -g gh-upload-log@latest'), true);
  fs.rmSync(stateDir, { recursive: true, force: true });
}

assert.equal(parseBunGlobalPackageVersion('/home/box/.bun/install/global node_modules\n├── @link-assistant/claude-profiles@1.2.3\n└── gh-load-issue@0.3.2\n', 'gh-load-issue'), '0.3.2', 'Bun global metadata identifies an operational CLI even when its executable is broken');

{
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-broken-cli-refresh-'));
  const env = { HIVE_MIND_STATE_DIR: stateDir, HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'gh-load-issue' };
  let installed = '0.3.2';
  const commands = [];
  const run = async (command, args) => {
    commands.push([command, ...args].join(' '));
    if (command === 'gh-load-issue') throw new Error('/bin/sh: import: not found');
    if (command === 'bun' && args.join(' ') === 'pm ls -g') return { stdout: `└── gh-load-issue@${installed}\n` };
    if (command === 'npm') return { stdout: '0.3.3\n' };
    if (command === 'bun' && args[0] === 'install') {
      installed = '0.3.3';
      return { stdout: 'installed' };
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };

  const result = await updateAgenticClisWhenIdle({ env, run, force: true, getActiveTasksImpl: async () => [] });
  assert.deepEqual(result.updated, [{ id: 'gh-load-issue', from: '0.3.2', to: '0.3.3' }]);
  assert.equal(commands.includes('bun pm ls -g'), true, 'a failed --version probe falls back to Bun package metadata');
  assert.equal(commands.includes('bun install -g gh-load-issue@latest'), true);
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('PASS: issue #2264 dependency freshness gate and idle operational CLI refresh');
