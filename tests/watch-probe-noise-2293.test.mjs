#!/usr/bin/env node
/**
 * Issue #2293 (item 5): the watch loop's probes (the PR comment threads, the
 * login, `.merged`, `.state`) are read, never shown. On
 * link-foundation/meta-language#196 the raw comments JSON (180 KB) was mirrored
 * into the attached log 7 times in a row, each copy preceded by the login.
 *
 * A child process runs the helpers with their default `$` against a fake `gh`
 * that answers with a recognisable payload; the payload must not reach stdout,
 * while the helpers still read it.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const SRC = new URL('../src/', import.meta.url);

const FAKE_GH = `#!/bin/sh
case "$*" in
  "api user --jq .login") echo LOGIN-PAYLOAD-2293 ;;
  *"--jq .merged"*) echo MERGED-PAYLOAD-2293 ;;
  *"--jq .state"*) echo STATE-PAYLOAD-2293 ;;
  *"/comments"*) printf '[{"id":1,"user":{"login":"someone"},"body":"COMMENTS-PAYLOAD-2293","created_at":"2099-01-01T00:00:00Z","updated_at":"2099-01-01T00:00:00Z"}]\\n' ;;
  *) echo "[]" ;;
esac
`;

const CHILD = `
const helpers = await import(${JSON.stringify(pathToFileURL(new URL('solve.auto-merge-helpers.lib.mjs', SRC).pathname).href)});
const shared = await import(${JSON.stringify(pathToFileURL(new URL('solve.restart-shared.lib.mjs', SRC).pathname).href)});
const comments = await helpers.checkForNonBotComments('o', 'r', 1, 2, new Date('2000-01-01T00:00:00Z'), false);
const merged = await shared.checkPRMerged('o', 'r', 1);
const closed = await shared.checkPRClosed('o', 'r', 1);
process.stdout.write('RESULT ' + JSON.stringify({ hasNewComments: comments.hasNewComments, bodies: comments.comments.map(c => c.body), merged, closed }) + '\\n');
`;

test('the watch probes read the comment threads, login and PR state without mirroring them', t => {
  const bin = mkdtempSync(join(tmpdir(), 'watch-probe-noise-2293-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);

  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const resultLine = stdout.split('\n').find(line => line.startsWith('RESULT '));
  assert.ok(resultLine, `no result line in:\n${stdout}`);
  const result = JSON.parse(resultLine.slice('RESULT '.length));
  // The fake answers the PR, review and issue comment endpoints alike.
  assert.equal(result.hasNewComments, true);
  assert.ok(result.bodies.length > 0 && result.bodies.every(body => body === 'COMMENTS-PAYLOAD-2293'), JSON.stringify(result.bodies));
  assert.deepEqual({ merged: result.merged, closed: result.closed }, { merged: false, closed: false });

  const shown = stdout.replace(resultLine, '');
  for (const payload of ['LOGIN-PAYLOAD-2293', 'MERGED-PAYLOAD-2293', 'STATE-PAYLOAD-2293', 'COMMENTS-PAYLOAD-2293']) {
    assert.equal(shown.includes(payload), false, `${payload} was mirrored:\n${shown}`);
  }
});
