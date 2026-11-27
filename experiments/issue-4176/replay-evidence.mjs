import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { findCredentialFindings, sanitizeWithPolicy } from '../../src/sensitive-data-sanitizer.lib.mjs';
import { forEachLogBlock } from '../../src/log-sanitize-stream.lib.mjs';

const [reporterLog, wrapperLog] = process.argv.slice(2);
if (!reporterLog || !wrapperLog) throw new Error('Pass the reporter log and a reconstructed wrapper log');

function inspect(label, text) {
  let findings;
  try {
    findings = findCredentialFindings(text).map(({ type, start, end }) => ({ type, start, end }));
    const output = sanitizeWithPolicy(text);
    console.log(JSON.stringify({ label, chars: text.length, findings, outputChars: output.length }));
  } catch (error) {
    console.log(JSON.stringify({ label, chars: text.length, findings, code: error.code }));
  }
}

const stdout = [];
for await (const line of createInterface({ input: createReadStream(reporterLog), crlfDelay: Infinity })) {
  const match = line.match(/^\[2026-11-27T07:25:07\.\d+Z\] \[STDOUT\] (.+)/);
  if (!match || (!stdout.length && !match[1].startsWith('{"type":"item.completed","item":{"id":"item_1253"'))) continue;
  stdout.push(match[1]);
  inspect(`reporter:chunk-${stdout.length}`, match[1]);
  if (stdout.length === 6) break;
}
inspect('reporter:last-visible-event', stdout.join(''));

let blockIndex = 0;
let blockStart = 0;
await forEachLogBlock(wrapperLog, block => {
  blockIndex++;
  if (blockIndex >= 101) inspect(`wrapper:block-${blockIndex}@${blockStart}`, block);
  blockStart += block.length;
  return blockIndex < 104;
});
