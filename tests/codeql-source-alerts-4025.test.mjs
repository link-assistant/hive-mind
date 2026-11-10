#!/usr/bin/env node
// @hive-mind-test-suite default,pr-essential

/**
 * Issue #4025: CodeQL had 44 open alerts on main and nothing failed on them.
 * security.yml now fails on any CodeQL result, so each alert was fixed in
 * code. This file pins the behaviour of the fixes in src/.
 */

import assert from 'node:assert/strict';
import { buildUserMention } from '../src/buildUserMention.lib.mjs';
import { escapeMarkdownV2 } from '../src/telegram-merge-command.lib.mjs';
import { escapeMarkdown } from '../src/telegram-accept-invitations.lib.mjs';
import { parseSpecifier } from '../src/use-m-single-flight.lib.mjs';
import { parseHumanBytes } from '../src/system-cleanup-estimates.lib.mjs';
import { parseGhUploadLogOutput } from '../src/log-upload.lib.mjs';
import { buildPrePullRequestFailureActionSection } from '../src/solve.pre-pr-failure-notifier.lib.mjs';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✅ PASS: ${name}`);
};

// js/incomplete-sanitization: MarkdownV2 needs `\` escaped too. Without it
// `a\_b` became `a\\_b`, an escaped backslash followed by a bare `_`, which
// opens an italic entity and Telegram rejects the message.
check('MarkdownV2 escapers escape the backslash first', () => {
  for (const escape of [escapeMarkdownV2, escapeMarkdown]) {
    assert.equal(escape('a\\_b'), 'a\\\\\\_b');
    assert.equal(escape('C:\\dir'), 'C:\\\\dir');
    assert.equal(escape('v1.2'), 'v1\\.2');
  }
  assert.equal(buildUserMention({ id: 1, first_name: 'a\\b_c', parseMode: 'MarkdownV2' }), '[a\\\\b\\_c](tg://user?id=1)');
});

// js/redos: `(?:\/[^@]+)*` backtracked exponentially on a path with no match.
check('module specifiers parse in linear time and keep their groups', () => {
  assert.deepEqual(parseSpecifier('@scope/pkg@1.2.3/a/b'), { packageName: '@scope/pkg', version: '1.2.3', modulePath: '/a/b' });
  assert.deepEqual(parseSpecifier('lodash'), { packageName: 'lodash', version: 'latest', modulePath: '' });
  const started = Date.now();
  assert.equal(parseSpecifier('a' + '/a'.repeat(40) + '@'), null);
  assert.ok(Date.now() - started < 1000, 'pathological specifier is rejected quickly');
});

// js/identity-replacement: `.replace(/IB$/, 'IB')` after toUpperCase did nothing.
check('binary units still parse', () => {
  assert.equal(parseHumanBytes('1.5 GiB'), Math.round(1.5 * 1024 ** 3));
  assert.equal(parseHumanBytes('2kib'), 2048);
  assert.equal(parseHumanBytes('3 MB'), 3 * 1024 ** 2);
});

// js/incomplete-url-substring-sanitization: compare hostnames, not substrings.
check('upload type comes from the URL hostname, not a substring', () => {
  assert.equal(parseGhUploadLogOutput('🔗 https://gist.github.com/u/abc\n').type, 'gist');
  assert.equal(parseGhUploadLogOutput('🔗 https://github.com/u/log-repo\n').type, 'repository');
  assert.equal(parseGhUploadLogOutput('🔗 https://github.com.evil.example/u/x\n').type, null);
  assert.equal(parseGhUploadLogOutput('🔗 https://evil.example/gist.github.com\n').type, null);
});

check('push failures are recognised by a github.com host in the reason', () => {
  const pushReason = 'Failed to push branch to https://github.com/o/r.git';
  const otherReason = 'Failed to push branch to https://notgithub.company.example/o/r.git';
  assert.notEqual(buildPrePullRequestFailureActionSection(pushReason), buildPrePullRequestFailureActionSection(otherReason));
});

console.log(`\ncodeql-source-alerts-4025.test.mjs: ${passed} checks passed`);
