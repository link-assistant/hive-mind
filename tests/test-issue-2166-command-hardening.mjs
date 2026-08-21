#!/usr/bin/env node

/**
 * Regression tests for issue #2166 — command-level requirements.
 *
 *  R3: the bot echoes only the part of a URL it actually interpreted, so
 *      `…/pull/18#issuecomment-5370631063` is shown (and queued, and matched) as
 *      `…/pull/18` — the comment fragment never reaches any lookup.
 *  R5: because both sides canonicalize, a chat owner can `/stop` a task that was
 *      started from a copied comment link (and vice versa).
 *  R6: `/fix` fails immediately on any unsupported option instead of forwarding
 *      the typo into a spawned work session where nobody sees it fail.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2166
 */

import { canonicalizeGitHubUrl, parseGitHubUrl } from '../src/github-url-parser.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { buildFixCommandArgs, validateFixCommandOptions } from '../src/telegram-fix-command.lib.mjs';

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

function assertEqual(actual, expected, testName) {
  assert(actual === expected, testName, actual === expected ? '' : `Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
}

// The exact URL from the issue report.
const PR_URL = 'https://github.com/Surrogate-TM/save_visiogetbb/pull/18';
const PR_URL_WITH_COMMENT = `${PR_URL}#issuecomment-5370631063`;

console.log('\n=== R3: only the interpreted part of a URL is echoed back ===\n');
{
  const parsed = parseGitHubUrl(PR_URL_WITH_COMMENT);
  assert(parsed.valid, 'the pasted comment link is still a valid PR URL');
  assertEqual(parsed.canonical, PR_URL, 'canonical drops the #issuecomment- fragment');
  assertEqual(parsed.number, 18, 'the target is resolved from the path, not the fragment');
  assert(parsed.normalized.includes('#issuecomment-'), 'normalized still carries the raw input (unchanged behaviour)');
}
{
  assertEqual(canonicalizeGitHubUrl(`${PR_URL}?foo=1`), PR_URL, 'query strings are dropped too');
  assertEqual(canonicalizeGitHubUrl(`${PR_URL}/`), PR_URL, 'trailing slashes are dropped');
  assertEqual(canonicalizeGitHubUrl(PR_URL), PR_URL, 'an already-canonical URL is unchanged');
  assertEqual(canonicalizeGitHubUrl('not a url'), 'not a url', 'unparseable input is returned as-is');
  assertEqual(canonicalizeGitHubUrl('https://github.com/owner/repo/issues/3#issue-1'), 'https://github.com/owner/repo/issues/3', 'issue URLs are canonicalized as well');
}

console.log('\n=== R5: /stop finds a task queued under the other spelling of the URL ===\n');
{
  const queue = new SolveQueue({ autoStart: false });
  queue.enqueue({ url: PR_URL, args: [PR_URL], tool: 'codex' });

  assert(queue.findByUrl(PR_URL_WITH_COMMENT) !== null, 'a task queued by canonical URL is found by the comment link');
  assert(queue.findByUrl(PR_URL) !== null, 'and by the canonical URL itself');
  assert(queue.findByUrl('https://github.com/Surrogate-TM/save_visiogetbb/pull/19') === null, 'a different PR is still not matched');
}
{
  const queue = new SolveQueue({ autoStart: false });
  queue.enqueue({ url: PR_URL_WITH_COMMENT, args: [PR_URL_WITH_COMMENT], tool: 'codex' });
  assert(queue.findByUrl(PR_URL) !== null, 'a task queued by comment link is found by the canonical URL');
}

console.log('\n=== R6: /fix rejects unsupported options immediately ===\n');
for (const { text, shouldFail, expect: expectation, name } of [
  { text: '/fix https://github.com/owner/repo --ci-cd', shouldFail: false, name: 'the documented invocation is accepted' },
  { text: '/fix owner/repo', shouldFail: false, name: '--ci-cd is implied and accepted' },
  { text: '/fix owner/repo --tool codex --model gpt-5.5 --think medium', shouldFail: false, name: 'options forwarded to /solve are accepted' },
  { text: '/fix owner/repo --dry-run --no-solve', shouldFail: false, name: "/fix's own options are accepted" },
  { text: '/fix owner/repo —ci-de', shouldFail: true, expect: '--ci-cd', name: 'a typo of --ci-cd is rejected and the right option suggested' },
  { text: '/fix owner/repo --think-hard', shouldFail: true, expect: 'think', name: 'an unknown solve option is rejected' },
  { text: '/fix owner/repo --totally-made-up', shouldFail: true, expect: 'totally-made-up', name: 'an option nobody supports is rejected' },
  { text: '/fix owner/repo -verbose', shouldFail: true, expect: 'verbose', name: 'a malformed single-dash long option is rejected' },
]) {
  const error = await validateFixCommandOptions(buildFixCommandArgs(text).args);
  if (shouldFail) {
    assert(typeof error === 'string' && error.length > 0, name, `Expected a rejection for ${text}, got ${JSON.stringify(error)}`);
    if (error && expectation) assert(error.includes(expectation), `${name} — message mentions "${expectation}"`, error);
  } else {
    assertEqual(error, null, name);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
