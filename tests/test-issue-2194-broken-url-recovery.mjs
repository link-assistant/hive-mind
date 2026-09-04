#!/usr/bin/env node

/**
 * Regression tests for issue #2194 — "We somehow unable to parse broken URLs".
 *
 * A user sent `/claude https://github.com/G-Ivan-A/aether-orbis/pulls/30`. The link
 * previewed fine in Telegram (github.com answers `/pulls/30` with HTTP 200 — the
 * pull request *list* page), so from the user's side the URL looked perfectly
 * valid, yet the bot replied "URL points to the pull requests list page". Every
 * byte needed to address pull request 30 was present in the string: the bot simply
 * threw the number away.
 *
 * The requirements these tests encode:
 *   R1  Recover a broken URL whenever the data to restore it is present
 *       (`/pulls/30` → `/pull/30`), and report what was recovered.
 *   R2  Survive invisible Unicode damage ("even if it split with unprintable
 *       unicode symbols or something") instead of silently addressing a repository
 *       whose name secretly contains a zero-width space.
 *   R3  Never widen recovery into a security hole: a non-GitHub host, a gist, or a
 *       look-alike domain must still be rejected.
 *   R4  Expose codepoint-level diagnostics so the next report can be root-caused
 *       from the log alone.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2194
 */

import { parseGitHubUrl } from '../src/github-url-parser.lib.mjs';
import { describeHiddenCharacters, repairGitHubPathParts, repairGitHubUrlText, revealHiddenCharacters } from '../src/github-url-recovery.lib.mjs';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    if (details) console.log(`     ${details}`);
    failed++;
  }
}

/** Assert that `input` is understood as the pull request / issue at `canonical`. */
function assertResolves(input, { type, canonical, number }, testName) {
  const parsed = parseGitHubUrl(input);
  const actual = { valid: parsed.valid, type: parsed.type, canonical: parsed.canonical, number: parsed.number };
  const ok = parsed.valid === true && parsed.type === type && parsed.canonical === canonical && parsed.number === number;
  assert(ok, testName, ok ? '' : `Expected ${JSON.stringify({ valid: true, type, canonical, number })}, got ${JSON.stringify(actual)}`);
}

/** Assert that `input` is rejected — recovery must never invent a GitHub target. */
function assertRejected(input, testName) {
  const parsed = parseGitHubUrl(input);
  const invented = parsed.valid && (parsed.type === 'issue' || parsed.type === 'pull' || parsed.type === 'repo');
  assert(!invented, testName, invented ? `Recovery invented a target: ${JSON.stringify(parsed)}` : '');
}

const ZWSP = '​';
const BOM = '﻿';
const LRM = '‎';
const SHY = '­';
const NBSP = ' ';

console.log('\n=== R1: the reported URL is recovered, not rejected ===\n');

// The exact URL from the issue report.
assertResolves('https://github.com/G-Ivan-A/aether-orbis/pulls/30', { type: 'pull', canonical: 'https://github.com/G-Ivan-A/aether-orbis/pull/30', number: 30 }, '/pulls/30 resolves to pull request 30');

assert(
  (() => {
    const parsed = parseGitHubUrl('https://github.com/G-Ivan-A/aether-orbis/pulls/30');
    return Array.isArray(parsed.repairs) && parsed.repairs.some(repair => repair.code === 'entity-kind-corrected');
  })(),
  'the recovery is reported back to the caller via parsed.repairs'
);

assert(
  (() => {
    const parsed = parseGitHubUrl('https://github.com/G-Ivan-A/aether-orbis/pulls/30');
    return parsed.recovered === true && parsed.original === 'https://github.com/G-Ivan-A/aether-orbis/pulls/30';
  })(),
  'parsed.recovered flags the repair and parsed.original keeps the URL as sent'
);

console.log('\n=== R1: a clean URL is untouched and reports no repair ===\n');

for (const url of ['https://github.com/owner/repo/pull/123', 'https://github.com/owner/repo/issues/7', 'https://github.com/owner/repo', 'https://github.com/owner']) {
  const parsed = parseGitHubUrl(url);
  assert(parsed.valid && parsed.recovered !== true && (parsed.repairs || []).length === 0, `no-op on a well-formed URL: ${url}`, JSON.stringify(parsed.repairs));
}

console.log('\n=== R1: the pull request *list* still means the list ===\n');

for (const [url, type] of [
  ['https://github.com/owner/repo/pulls', 'pulls_list'],
  ['https://github.com/owner/repo/issues', 'issues_list'],
]) {
  const parsed = parseGitHubUrl(url);
  assert(parsed.valid && parsed.type === type, `${url} stays ${type}`, `got ${parsed.type}`);
}

console.log('\n=== R1: other shapes that carry enough data to restore ===\n');

const RECOVERABLE = [
  ['https://github.com/owner/repo/pull/30/files', 'pull', 30],
  ['https://github.com/owner/repo/pulls/30/commits', 'pull', 30],
  ['https://github.com/owner/repo/issue/123', 'issue', 123],
  ['https://github.com/owner/repo/Issues/123', 'issue', 123],
  ['https://github.com/owner/repo/pull-requests/30', 'pull', 30],
  ['Https://GitHub.com/owner/repo/pull/30', 'pull', 30],
  ['GITHUB.COM/owner/repo/pull/30', 'pull', 30],
  ['https://www.github.com/owner/repo/pull/30', 'pull', 30],
  ['https://api.github.com/repos/owner/repo/pulls/30', 'pull', 30],
  ['git@github.com:owner/repo.git', null, undefined],
  ['https://github.com//owner//repo//pull//30', 'pull', 30],
  ['(https://github.com/owner/repo/pull/30)', 'pull', 30],
  ['<https://github.com/owner/repo/pull/30>', 'pull', 30],
  ['"https://github.com/owner/repo/pull/30"', 'pull', 30],
  ['[PR 30](https://github.com/owner/repo/pull/30)', 'pull', 30],
  ['https://github.com/owner/repo/pull/30.', 'pull', 30],
  ['https://github.com/owner/repo/pull/30,', 'pull', 30],
  ['https：//github.com/owner/repo/pull/30', 'pull', 30],
  ['https://github.com/owner/repo/pull/３０', 'pull', 30],
];

for (const [input, type, number] of RECOVERABLE) {
  if (type === null) continue;
  assertResolves(input, { type, canonical: `https://github.com/owner/repo/${type === 'pull' ? 'pull' : 'issues'}/${number}`, number }, `recovers: ${JSON.stringify(input)}`);
}

assert(
  (() => {
    const parsed = parseGitHubUrl('git@github.com:owner/repo.git');
    return parsed.valid && parsed.type === 'repo' && parsed.canonical === 'https://github.com/owner/repo';
  })(),
  'recovers an SSH remote: git@github.com:owner/repo.git → https://github.com/owner/repo'
);

console.log('\n=== R2: invisible Unicode damage ===\n');

assertResolves(`https://github.com/owner/repo/pull/${ZWSP}30`, { type: 'pull', canonical: 'https://github.com/owner/repo/pull/30', number: 30 }, 'zero-width space before the number');
assertResolves(`${BOM}https://github.com/owner/repo/pulls/30`, { type: 'pull', canonical: 'https://github.com/owner/repo/pull/30', number: 30 }, 'BOM in front of a broken URL');
assertResolves(`https://github.com/ow${SHY}ner/repo/pull/30`, { type: 'pull', canonical: 'https://github.com/owner/repo/pull/30', number: 30 }, 'soft hyphen inside the owner');
assertResolves(`${LRM}https://github.com/owner/re${ZWSP}po/pull/30${LRM}`, { type: 'pull', canonical: 'https://github.com/owner/repo/pull/30', number: 30 }, 'bidi marks around and inside the URL');
assertResolves(`https://github.com/owner/repo/pull/30${NBSP}`, { type: 'pull', canonical: 'https://github.com/owner/repo/pull/30', number: 30 }, 'trailing no-break space');

assert(
  (() => {
    const parsed = parseGitHubUrl(`https://github.com/owner/re${ZWSP}po/pull/30`);
    return parsed.repo === 'repo' && !parsed.canonical.includes('%E2%80%8B');
  })(),
  'a zero-width space no longer leaks into the repository name'
);

console.log('\n=== R3: recovery must not invent GitHub targets ===\n');

for (const hostile of [
  'https://gitlab.com/owner/repo/pull/30',
  'https://bitbucket.org/owner/repo/pull-requests/30',
  'https://gist.github.com/owner/abc123',
  'https://raw.githubusercontent.com/owner/repo/main/f.txt',
  'https://github.com.evil.com/owner/repo/pull/30',
  'https://evil.com/github.com/owner/repo/pull/30',
  'https://example.com/issues/123',
  'not a url at all',
  '',
  '!!!',
  // Recovery must not over-reach in the other direction either: unwrapping prose
  // punctuation is only worth doing when what comes out already names github.com.
  '[a](b)',
  '"just-a-word"',
  '(some-token)',
  // An email address at github.com is not a repository URL.
  'me@github.com',
  'support@github.com',
]) {
  assertRejected(hostile, `rejected: ${JSON.stringify(hostile)}`);
}

// ...while the SSH remote form, which uses the same `user@host` shape, still works.
assert(parseGitHubUrl('git@github.com:owner/repo.git').canonical === 'https://github.com/owner/repo', 'an SSH remote is still read as its web address');
assert(parseGitHubUrl('ssh://git@github.com/owner/repo').canonical === 'https://github.com/owner/repo', 'an ssh:// URL is still read as its web address');
assert(parseGitHubUrl('[PR 30](https://github.com/owner/repo/pull/30)').canonical === 'https://github.com/owner/repo/pull/30', 'a Markdown link whose target names github.com is still unwrapped');

console.log('\n=== R4: codepoint-level diagnostics ===\n');

assert(
  describeHiddenCharacters(`a${ZWSP}b`).some(entry => entry.escape === 'U+200B' && entry.name === 'ZERO WIDTH SPACE'),
  'describeHiddenCharacters names a zero-width space'
);
assert(describeHiddenCharacters('https://github.com/owner/repo/pull/30').length === 0, 'describeHiddenCharacters is silent on a clean URL');
assert(revealHiddenCharacters(`a${ZWSP}b`) === 'a[U+200B]b', 'revealHiddenCharacters renders the escape inline', revealHiddenCharacters(`a${ZWSP}b`));
assert(
  (() => {
    const parsed = parseGitHubUrl(`https://github.com/owner/re${ZWSP}po/pull/30`);
    return typeof parsed.revealed === 'string' && parsed.revealed.includes('[U+200B]');
  })(),
  'the parse result carries a revealed form of the original input'
);

console.log('\n=== Unit level: the recovery primitives ===\n');

assert(repairGitHubUrlText('https://github.com/owner/repo/pull/30').repairs.length === 0, 'repairGitHubUrlText is a no-op on a clean URL');
assert(repairGitHubUrlText('https://gist.github.com/a/b').rejection === 'Not a GitHub URL', 'repairGitHubUrlText rejects gist.github.com');
assert(repairGitHubPathParts(['owner', 'repo', 'pulls', '30']).parts.join('/') === 'owner/repo/pull/30', 'repairGitHubPathParts rewrites pulls/30 → pull/30');
assert(repairGitHubPathParts(['owner', 'repo', 'pulls']).parts.join('/') === 'owner/repo/pulls', 'repairGitHubPathParts leaves the bare list alone');

console.log(`\n===========================================\nResults: ${passed} passed, ${failed} failed\n===========================================\n`);

if (failed > 0) process.exit(1);
console.log('✅ All issue #2194 recovery tests passed!');
