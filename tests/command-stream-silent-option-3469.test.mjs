#!/usr/bin/env node
/**
 * Issue #3469: `$({ silent: true })` is not a command-stream option, so every
 * "silent" probe was still mirrored into the log attached to the pull request.
 * With an installation token (GITHUB_TOKEN) the solver's log then showed
 *
 *   [STDOUT] {"message":"Resource not accessible by integration",...,"status":"403"}gh: Resource not accessible by integration (HTTP 403)
 *   Warning: Could not get current user
 *
 * for a lookup that cannot work with that token type by design.
 *
 * @hive-mind-test-suite default
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('command-stream mirrors `silent: true` and honours `mirror: false`', () => {
  const dollarUrl = pathToFileURL(join(repoRoot, 'node_modules', 'command-stream', 'src', '$.mjs')).href;
  const script = `const { $ } = await import(${JSON.stringify(dollarUrl)});
const loud = await $({ silent: true })\`echo with-silent\`;
const quiet = await $({ mirror: false })\`echo with-mirror-false\`;
process.stderr.write(JSON.stringify([loud.stdout, quiet.stdout]));`;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(stdout, /with-silent/, 'silent is not an option: the output is mirrored');
  assert.doesNotMatch(stdout, /with-mirror-false/, 'mirror: false keeps the output out of stdout');
});

test('no source file relies on the nonexistent `silent` option of $', async () => {
  const files = (await readdir(join(repoRoot, 'src'), { recursive: true })).filter(name => name.endsWith('.mjs'));
  const offenders = [];
  for (const name of files) {
    const source = await readFile(join(repoRoot, 'src', name), 'utf8');
    source.split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/\bsilent:\s*true\b/.test(line)) offenders.push(`src/${name}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('the auto-PR user lookup explains an installation token instead of warning', async () => {
  const source = await readFile(join(repoRoot, 'src', 'solve.auto-pr.lib.mjs'), 'utf8');
  assert.match(source, /const currentUserResult = await quietProbe\(\$\)`gh api user --jq \.login 2>&1`;/);
  assert.match(source, /isIntegrationForbidden\(/);
  assert.match(source, /a GitHub App installation token cannot read GET \/user/);
});
