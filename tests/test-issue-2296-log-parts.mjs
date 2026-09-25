#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2296 (part D): the failure comment of a 20-hour session linked only
 * the folder holding the split log, so the reader had to guess which 100 MB
 * part held the failure. Every part must be linked and the part holding the
 * failure named. gh-upload-log prints "File count" only with --verbose, so the
 * split must be discovered from the folder listing, not from its output.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildFailureNeedles, describeUploadedLogParts, findLastOccurrenceOffset, formatLogPartLinks, parseRepositoryTreeUrl, partIndexForOffset, selectLogParts } from '../src/log-upload-parts.lib.mjs';
import { uploadLogWithGhUploadLog } from '../src/log-upload.lib.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

const TREE_URL = 'https://github.com/bot/log-storage/tree/main/tmp-solve-2026/0a1b2c';
const blob = name => `https://github.com/bot/log-storage/blob/main/tmp-solve-2026/0a1b2c/${name}`;
const LISTING = ['solve.part-02.log.txt', 'solve.part-00.log.txt', '.keep', 'solve.part-01.log.txt'].map(name => ({ name, html_url: blob(name), size: 10 }));
const ERROR = 'Failed to authenticate. API Error: 401 OAuth session expired and could not be refreshed';

console.log('\n--- Parts of a split upload ---');
assertEqual(parseRepositoryTreeUrl(TREE_URL), { owner: 'bot', repo: 'log-storage', branch: 'main', treePath: 'tmp-solve-2026/0a1b2c' }, 'the tree URL printed by gh-upload-log is parsed');
assertEqual(
  selectLogParts(LISTING).map(part => part.name),
  ['solve.part-00.log.txt', 'solve.part-01.log.txt', 'solve.part-02.log.txt'],
  'parts are kept in order and other files are ignored'
);
assertEqual(buildFailureNeedles([`${ERROR}\nstack...`, '', 'short']), [ERROR], 'the first line of the error message is the search needle');
assertEqual(partIndexForOffset({ offset: 250, partCount: 3, partSize: 100 }), 2, 'a byte offset maps to its part');
assertEqual(partIndexForOffset({ offset: 999, partCount: 3, partSize: 100 }), 2, 'the part index is clamped to the parts that exist');

console.log('\n--- Locating the failure in the uploaded file ---');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2296-parts-'));
const file = path.join(dir, 'sanitized.log');
const filler = size => 'x'.repeat(size - 1) + '\n';
fs.writeFileSync(file, filler(1000) + filler(500) + `${ERROR}\n` + filler(1200));
const errorOffset = 1500;
assertEqual(await findLastOccurrenceOffset({ file, needles: [ERROR], blockBytes: 64 }), errorOffset, 'the failure is found even when it straddles read blocks');
assertEqual(await findLastOccurrenceOffset({ file, needles: ['not in the log'] }), -1, 'a missing needle returns -1');

const ghApi = async apiPath => {
  assertEqual(apiPath, 'repos/bot/log-storage/contents/tmp-solve-2026/0a1b2c?ref=main', 'the folder of the upload is listed');
  return { code: 0, stdout: JSON.stringify(LISTING) };
};
const located = await describeUploadedLogParts({ url: TREE_URL, uploadedFile: file, failureMessages: [ERROR], ghApi, partSize: 1000 });
assertEqual([located.parts.length, located.failurePartIndex, located.failureLocated], [3, 1, true], 'the part holding the failure is identified (part 2 of 3)');
const guessed = await describeUploadedLogParts({ url: TREE_URL, uploadedFile: file, failureMessages: ['Some other failure text'], ghApi, partSize: 1000 });
assertEqual([guessed.failurePartIndex, guessed.failureLocated], [2, false], 'an unmatched failure points at the last part, where solve logs it');
const success = await describeUploadedLogParts({ url: TREE_URL, uploadedFile: file, failureMessages: [], ghApi, partSize: 1000 });
assertEqual(success.failurePartIndex, null, 'a successful run marks no part');

console.log('\n--- Comment markdown ---');
const markdown = formatLogPartLinks({ parts: located.parts, failurePartIndex: 1, failureLocated: true });
assertEqual(markdown.split('\n').length, 3, 'one line per part');
assertEqual(markdown.includes(`[Part 1 of 3: \`solve.part-00.log.txt\`](${blob('solve.part-00.log.txt')})`), true, 'each part has its own link');
assertEqual(/Part 2 of 3.*contains the failure/.test(markdown) && !/Part [13] of 3.*contains the failure/.test(markdown), true, 'only the failing part is named');
assertEqual(formatLogPartLinks({ parts: located.parts.slice(0, 1) }), '', 'a single-file upload adds no part list');

console.log('\n--- uploadLogWithGhUploadLog: split detected without --verbose output ---');
const runUpload = async () => ({ code: 0, stdout: `✅ Repository created (public)\n🔗 ${TREE_URL}\n`, stderr: '' });
const uploaded = await uploadLogWithGhUploadLog({ logFile: file, isPublic: true, description: 'test', failureMessages: [ERROR], runUpload, ghApi });
assertEqual([uploaded.success, uploaded.chunks, uploaded.parts?.length, uploaded.failureLocated], [true, 3, 3, true], 'the three parts are reported and the failure is located');
assertEqual(uploaded.rawUrl === blob('solve.part-00.log.txt') || /raw\/main\/.*part-00/.test(uploaded.rawUrl || ''), false, 'the first part is no longer passed off as the whole log');

console.log('\n--- Every log comment variant carries the part list ---');
const githubSrc = fs.readFileSync(new URL('../src/github.lib.mjs', import.meta.url), 'utf8');
assertEqual((githubSrc.match(/\]\(\$\{logUrl\}\)\$\{partLinksBlock\}/g) || []).length, 4, 'usage-limit, failure, finished-with-errors and success comments list the parts');
assertEqual(/failureMessages: errorMessage \? \[errorMessage\] : \[\]/.test(githubSrc), true, 'the failure message is passed to the uploader to locate the part');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
