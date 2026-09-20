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
 * means.
 *
 * This script builds the block a regressed handler would produce: one showing
 * `<repo>/issues/2212` where the repository URL belongs — the exact mislabelling
 * the assertion exists to catch. Because that URL is the repository URL plus a
 * path, *any* containment test for the repository URL passes on it by
 * construction: a string always contains its own prefix. That is the weakness,
 * and establishing it needs no execution — so this file does not spell the old
 * check out, which would only reproduce the flagged pattern one directory over.
 *
 * What the run below shows is the other half: the equality check the test now
 * uses rejects that block, and still accepts the correct one.
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
const correctBlock = buildTelegramInfoBlock({ urlKind: 'url', url: REPO_URL });

console.log('block a regressed handler would produce:');
console.log(JSON.stringify(regressedBlock));
console.log('');
console.log(`the URL it shows is ${JSON.stringify(WRONG_URL)},`);
console.log(`built as REPO_URL + ${JSON.stringify('/issues/2212')} — so it contains REPO_URL by construction,`);
console.log('which is why a containment check could not tell this block from a correct one.');
console.log('');

const caught = urlLineOf(regressedBlock).url !== REPO_URL;
const stillPasses = urlLineOf(correctBlock).url === REPO_URL;

console.log(`new  urlLineOf(block).url === REPO_URL  on the regressed block -> ${!caught}  ${caught ? '(fails — the bug is caught)' : '(passes — the bug slips through)'}`);
console.log(`new  urlLineOf(block).url === REPO_URL  on the correct block   -> ${stillPasses}  ${stillPasses ? '(passes)' : '(fails)'}`);
console.log('');
console.log(caught ? '✅ the tightened assertion catches a mislabelling containment could not' : '❌ the tightened assertion accepts the regressed block — it is no stronger');
console.log(stillPasses ? '✅ the tightened assertion still passes on the correct block' : '❌ the tightened assertion rejects the correct block');

// tests/test-telegram-solve-repository-url-2212.mjs asserts the same property,
// so this is guarded by CI and not only by running this script.
process.exit(caught && stillPasses ? 0 : 1);
