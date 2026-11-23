#!/usr/bin/env node
/**
 * Issue #4082, case 7: pre-commit hooks failed in the task image with
 *
 *     lefthook runner: failed to start corepack: spawnSync corepack ENOENT
 *
 * because Node 26 no longer bundles corepack and the Dockerfile skipped the
 * inherited copy. The image now installs corepack, and solve tells the AI when
 * a repository's hooks still cannot run, so their checks are never skipped
 * silently.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGitHooksPreflightLines, detectGitHookProblems, findGitHookConfigs, isOnPath, runGitHooksPreflight } from '../src/git-hooks-preflight.lib.mjs';
import { parseDockerDependencyPins } from '../scripts/dependency-freshness.lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const withRepo = (files, run) => {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-4082-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const installed =
  (...names) =>
  name =>
    names.includes(name);

const LEFTHOOK_PNPM = {
  'package.json': JSON.stringify({ name: 'x', packageManager: 'pnpm@9.15.0', devDependencies: { lefthook: '^1.8.0' } }),
  'lefthook.yml': 'pre-commit:\n  commands:\n    format:\n      run: pnpm exec prettier --check {staged_files}\n',
};

test('case 7: lefthook with packageManager pnpm and no corepack is reported (the incident)', () =>
  withRepo(LEFTHOOK_PNPM, dir => {
    const result = detectGitHookProblems(dir, { commandExists: installed('git', 'node', 'npm') });
    assert.deepEqual(result.configFiles, ['lefthook.yml']);
    assert.equal(result.reasons.length, 1, result.reasons.join('\n'));
    assert.match(result.reasons[0], /packageManager: pnpm@9\.15\.0/);
    assert.match(result.reasons[0], /corepack` is not installed \(pnpm is not installed either/);
    assert.match(result.reasons[0], /spawnSync corepack ENOENT/);

    const lines = buildGitHooksPreflightLines(result).join('\n');
    assert.match(lines, /Git hooks in this repository cannot run in this environment/);
    assert.match(lines, /`lefthook\.yml`/);
    assert.match(lines, /Never bypass them silently/);
  }));

test('case 7: with corepack installed (the fixed image) the same repository needs no warning', () =>
  withRepo(LEFTHOOK_PNPM, dir => {
    const result = detectGitHookProblems(dir, { commandExists: installed('corepack', 'pnpm', 'npx') });
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(buildGitHooksPreflightLines(result), []);
  }));

test('case 7: pnpm alone does not help hooks that start it through corepack', () =>
  withRepo(LEFTHOOK_PNPM, dir => {
    const [reason] = detectGitHookProblems(dir, { commandExists: installed('pnpm') }).reasons;
    assert.match(reason, /pnpm itself is installed, but hooks that start it through corepack still fail/);
  }));

test('case 7: husky, pre-commit and simple-git-hooks commands that are missing are named', () => {
  withRepo({ '.husky/pre-commit': 'yarn lint-staged\n', '.husky/_/husky.sh': 'internal', 'package.json': '{}' }, dir => {
    const result = detectGitHookProblems(dir, { commandExists: installed() });
    assert.deepEqual(result.configFiles, ['.husky/pre-commit']);
    assert.deepEqual(result.reasons, ['`.husky/pre-commit` runs `yarn`, which is not installed.']);
  });
  withRepo({ '.pre-commit-config.yaml': 'repos:\n  - repo: local\n    hooks:\n      - id: ruff\n        entry: uv run ruff check\n' }, dir => {
    const result = detectGitHookProblems(dir, { commandExists: installed() });
    assert.equal(result.reasons.length, 2, result.reasons.join('\n'));
    assert.match(result.reasons[0], /runs `uv`/);
    assert.match(result.reasons[1], /`pre-commit` tool is not installed/);
  });
  withRepo({ 'package.json': JSON.stringify({ 'simple-git-hooks': { 'pre-commit': 'bunx lint-staged' } }) }, dir => {
    assert.deepEqual(detectGitHookProblems(dir, { commandExists: installed() }).reasons, ['`package.json ("simple-git-hooks")` runs `bunx`, which is not installed.']);
  });
});

test('case 7: a local node_modules/.bin tool counts as installed; a repository without hooks gets nothing', () => {
  withRepo({ '.husky/pre-commit': 'npx lint-staged\n', 'node_modules/.bin/npx': '' }, dir => {
    assert.deepEqual(detectGitHookProblems(dir, { commandExists: installed() }).reasons, []);
  });
  withRepo({ 'package.json': JSON.stringify({ packageManager: 'pnpm@9.0.0' }), 'README.md': 'pnpm install' }, dir => {
    assert.deepEqual(detectGitHookProblems(dir, { commandExists: installed() }), { configFiles: [], reasons: [] });
  });
  withRepo({ 'lefthook.yml': 'pre-commit:\n  commands:\n    t:\n      run: make test\n' }, dir => {
    assert.deepEqual(detectGitHookProblems(dir, { commandExists: installed() }).reasons, ['lefthook is configured but not installed (no `lefthook` on PATH and no lefthook dependency in package.json).']);
  });
  assert.deepEqual(findGitHookConfigs(join(tmpdir(), 'does-not-exist-4082')), { files: [], packageJson: null });
});

test('case 7: the probe runs from solve and logs what it found', async () => {
  await withRepo(LEFTHOOK_PNPM, async dir => {
    const logs = [];
    const result = await runGitHooksPreflight({ tempDir: dir, log: async message => logs.push(message), commandExists: installed() });
    assert.ok(result.promptLines.length > 0);
    assert.match(logs.join('\n'), /Git hooks: package\.json pins/);
  });
  const solveSource = readFileSync(join(root, 'src', 'solve.mjs'), 'utf8');
  assert.match(solveSource, /const cloneStatusLines = \[\.\.\.\(cloneStatus\?\.promptLines \|\| \[\]\), \.\.\.\(await \(await import\('\.\/git-hooks-preflight\.lib\.mjs'\)\)\.runGitHooksPreflight\(\{ tempDir, log \}\)\)\.promptLines\];/);
});

test('case 7: isOnPath finds executables only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'path-4082-'));
  try {
    writeFileSync(join(dir, 'corepack'), '#!/bin/sh\n');
    chmodSync(join(dir, 'corepack'), 0o755);
    writeFileSync(join(dir, 'pnpm'), 'not executable');
    chmodSync(join(dir, 'pnpm'), 0o644);
    assert.equal(isOnPath('corepack', { env: { PATH: dir } }), true);
    assert.equal(isOnPath('yarn', { env: { PATH: dir } }), false);
    if (process.getuid?.() !== 0) assert.equal(isOnPath('pnpm', { env: { PATH: dir } }), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('case 7: both images install a pinned corepack before the inherited globals, and the image check requires it', () => {
  for (const file of ['Dockerfile', 'Dockerfile.dind']) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.match(source, /^ARG HIVE_MIND_COREPACK_VERSION=\d+\.\d+\.\d+$/m, file);
    const install = source.indexOf('npm install -g "corepack@${HIVE_MIND_COREPACK_VERSION}" --no-fund --force && \\\n    corepack --version && \\');
    const globals = source.indexOf('if [ -n "$GLOBAL_SPECS" ]; then npm install -g $GLOBAL_SPECS');
    assert.ok(install !== -1, `${file}: corepack is installed and checked`);
    assert.ok(globals !== -1 && install < globals, `${file}: an inherited pnpm/yarn is installed after corepack, so its shims do not replace it`);
  }
  assert.match(readFileSync(join(root, 'scripts', 'verify-docker-image.sh'), 'utf8'), /check_tool "Corepack"\s+corepack\s+--version/);
  const pin = parseDockerDependencyPins(readFileSync(join(root, 'Dockerfile'), 'utf8'), 'Dockerfile').find(record => record.name === 'corepack');
  assert.equal(pin?.kind, 'npm', 'the corepack pin is checked for freshness like any other npm pin');
});
