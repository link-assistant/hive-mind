#!/usr/bin/env node

/**
 * Why `tests/test-telegram-solve-repository-url-2212.mjs` stopped searching the
 * info block for the repository URL.
 *
 * CodeQL raised js/incomplete-url-substring-sanitization (high) on
 *
 *     assertTrue('repository info block shows the repository URL', repoBlock.includes(REPO_URL), repoBlock);
 *
 * The alert is wrong about the security property — nothing here sanitizes a
 * URL, the block is built by our own code from a value the test supplies — and
 * right about the code: `.includes(url)` is not what "the block shows this URL"
 * means. It also passes when the block shows a *different, longer* URL that
 * merely starts with the repository URL, which is precisely the mislabelling
 * the assertion exists to catch.
 *
 * This script builds that case and shows the old assertion passing over it
 * while the new one fails, so the tightening is a real improvement rather than
 * a way to silence the scanner.
 *
 * Run: node experiments/issue-2212-codeql-url-substring.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2212
 */

import { buildTelegramInfoBlock } from '../src/telegram-ui-messages.lib.mjs';

const REPO_URL = 'https://github.com/link-assistant/hive-mind';
// What a regressed handler could put in the block instead: it kept the issue
// URL it was given rather than the repository URL /solve was invoked with.
const WRONG_URL = `${REPO_URL}/issues/2212`;

const urlLineOf = block => {
  const line = block.split('\n')[1] ?? '';
  const separator = line.indexOf(': ');
  return separator === -1 ? { label: line, url: '' } : { label: line.slice(0, separator), url: line.slice(separator + 2) };
};

const regressedBlock = buildTelegramInfoBlock({ urlKind: 'url', url: WRONG_URL });

const oldAssertion = regressedBlock.includes(REPO_URL);
const newAssertion = urlLineOf(regressedBlock).url === REPO_URL;

console.log('block a regressed handler would produce:');
console.log(JSON.stringify(regressedBlock));
console.log('');
console.log(`old  repoBlock.includes(REPO_URL)          -> ${oldAssertion}  ${oldAssertion ? '(passes — the bug slips through)' : '(fails)'}`);
console.log(`new  urlLineOf(repoBlock).url === REPO_URL -> ${newAssertion}  ${newAssertion ? '(passes)' : '(fails — the bug is caught)'}`);
console.log('');

// The point of the experiment: the old assertion accepted this block, the new
// one rejects it.
const demonstrated = oldAssertion === true && newAssertion === false;
console.log(demonstrated ? '✅ the tightened assertion catches a mislabelling the substring search missed' : '❌ the two assertions agree here — the experiment proves nothing');

// And the new assertion still passes on a correct block.
const correctBlock = buildTelegramInfoBlock({ urlKind: 'url', url: REPO_URL });
const stillPasses = urlLineOf(correctBlock).url === REPO_URL;
console.log(stillPasses ? '✅ the tightened assertion still passes on the correct block' : '❌ the tightened assertion rejects the correct block');

process.exit(demonstrated && stillPasses ? 0 : 1);
