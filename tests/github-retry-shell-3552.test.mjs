#!/usr/bin/env node
/**
 * Issue #3552: shell scripts and workflow `run:` blocks are held to the same
 * rule as the JavaScript code - every GitHub operation runs under the shared
 * retry loop, here through the `scripts/github-retry.mjs` CLI, and
 * `scripts/check-github-retry-shell.mjs` (chained into `npm run lint`) fails
 * on any that does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkFiles, findUnretriedShellOperations, workflowRunLines } from '../scripts/check-github-retry-shell.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const detectUnretried = source => findUnretriedShellOperations(source.split('\n')).map(v => `${v.line}:${v.label}`);

test('bare GitHub operations in shell are reported, whatever wraps the line', () => {
  assert.deepEqual(detectUnretried('gh release upload "$tag" a.tgz --clobber'), ['1:gh release upload']);
  assert.deepEqual(detectUnretried('set -e\nif ! gh release view "$tag" >/dev/null 2>&1; then'), ['2:gh release view']);
  assert.deepEqual(detectUnretried('BRANCHES=$(gh api "repos/$o/$r/branches" --jq .[].name)'), ['1:gh api repos/$o/$r/branches']);
  assert.deepEqual(detectUnretried('cd "$dir" && git push origin HEAD:main'), ['1:git push']);
  assert.deepEqual(detectUnretried('GIT_TRACE=1 timeout 60 git fetch origin main'), ['1:git fetch']);
  assert.deepEqual(detectUnretried('sudo gh auth status'), ['1:gh auth status']);
});

test('retried, local and escaped commands pass', () => {
  assert.deepEqual(detectUnretried('node scripts/github-retry.mjs gh release upload "$tag" a.tgz'), []);
  assert.deepEqual(detectUnretried('node "$(dirname "$0")/github-retry.mjs" git fetch origin "$BASE_REF"'), []);
  assert.deepEqual(detectUnretried('retry() { node "$(dirname "$0")/github-retry.mjs" "$@"; }\nretry gh release view "$tag"'), []);
  assert.deepEqual(detectUnretried('git status --porcelain\ngit commit -m "gh api"\ngh --version\ngh auth token'), []);
  assert.deepEqual(detectUnretried('echo "run gh api user to check"'), [], 'a mention inside an echo is not a call');
  assert.deepEqual(detectUnretried('# gh api user\ngit rev-parse HEAD # then git push'), [], 'comments are ignored');
  assert.deepEqual(detectUnretried('# github-retry-ok: interactive probe\ngh auth status'), []);
  assert.deepEqual(detectUnretried('gh auth status # github-retry-ok: interactive probe'), []);
});

test('a local function that does not call the CLI does not hide the operation', () => {
  assert.deepEqual(detectUnretried('retry() { "$@"; }\nretry gh release view "$tag"'), ['2:gh release view']);
});

test('workflow run blocks are checked with their original line numbers', () => {
  const yaml = ['jobs:', '  a:', '    steps:', '      - name: Download', '        run: |', '          mkdir -p dir', '          gh release download v1 --repo o/r --dir dir', '      - run: git push origin main', '      # github-retry-ok: the step is itself retried by the caller', '      - run: git fetch origin', '      - name: Retried', '        run: node scripts/github-retry.mjs gh api user', '        env:', '          NOTE: gh api user'].join('\n');
  assert.deepEqual(
    findUnretriedShellOperations(workflowRunLines(yaml)).map(v => `${v.line}:${v.label}`),
    ['7:gh release download', '8:git push'],
    'env values and other keys are not shell'
  );
});

test('the repository has no unretried GitHub operation in shell or workflows', () => {
  const files = execFileSync('git', ['ls-files', '*.sh', '.github/workflows/*.yml'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(file => file && !/^(experiments|examples|docs|dev)\//.test(file))
    .map(file => join(repoRoot, file));
  assert.ok(files.length > 10, 'the scan sees the shell scripts and workflows');
  assert.deepEqual(checkFiles(files), []);
});

test('github-retry.mjs retries a transient gh failure, keeps stdout clean, and runs local commands once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-cli-3552-'));
  const counter = join(dir, 'count');
  // Fails twice with a 502, then succeeds; `gh --version` (local) always fails.
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho x >> "${counter}"\nif [ "$1" = --version ]; then echo 'HTTP 502: Bad Gateway' >&2; exit 1; fi\nn=$(wc -l < "${counter}")\nif [ "$n" -lt 3 ]; then echo 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' >&2; exit 1; fi\necho '{"ok":true}'\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, HIVE_MIND_GITHUB_RETRY_DELAY_MS: '1' };
  const count = () => (existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').length : 0);
  const cli = join(repoRoot, 'scripts', 'github-retry.mjs');

  const ok = spawnSync(process.execPath, [cli, 'gh', 'api', 'user'], { env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, '{"ok":true}\n', 'stdout carries only the command output');
  assert.match(ok.stderr, /502/, 'the failed attempts stay visible on stderr');
  assert.equal(count(), 3);

  const local = spawnSync(process.execPath, [cli, 'gh', '--version'], { env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(local.status, 1, 'the exit code is passed through');
  assert.equal(count(), 4, 'a local command is not retried');
});
