// Finite, repeatable synthetic binary probe; at most twelve 200 KiB inputs.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createCredentialStreamSanitizer } from '../../src/credential-sanitization-core.lib.mjs';
import { findCredentialFindings } from '../../src/sensitive-data-sanitizer.lib.mjs';

for (let seed = 0; seed < 12; seed++) {
  const bytes = Buffer.alloc(150000);
  for (let at = 0; at < bytes.length; at += 32) createHash('sha256').update(`issue-3739:${seed}:${at}`).digest().copy(bytes, at);
  const base64 = bytes.toString('base64');
  for (const [kind, input, width] of [
    ['image', JSON.stringify({ type: 'image', data: base64 }) + '\n', 4096],
    ['wrapped', base64.match(/.{1,76}/g).join('\n') + '\n', 77],
  ]) {
    const stream = createCredentialStreamSanitizer({ includeEnvironmentCredentials: false });
    let output = '';
    for (let at = 0; at < input.length; at += width) output += stream.write(input.slice(at, at + width));
    output += stream.flush();
    const firstDifference = [...input].findIndex((char, index) => char !== output[index]);
    console.log(JSON.stringify({ seed, kind, preserved: output === input, firstDifference, inputLength: input.length, outputLength: output.length }));
    if (output !== input) {
      writeFileSync('/tmp/issue-3739-research/binary-stream-input.txt', input);
      writeFileSync('/tmp/issue-3739-research/binary-stream-output.txt', output);
      console.log(JSON.stringify(findCredentialFindings(input).map(({ rule, start, end, type }) => ({ rule, start, end, type }))));
      process.exitCode = 1;
      break;
    }
  }
  if (process.exitCode) break;
}
