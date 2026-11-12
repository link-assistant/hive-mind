// Finite resource-light reproduction of #3747; no source data is printed.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createCredentialStreamSanitizer } from '../../src/credential-sanitization-core.lib.mjs';
// Include the production log's 627,364-character payload and the issue's
// 1 MB case, keeping the inputs finite and free of random credential matches.
const images = [150000, 470523, 750000].map(bytes => JSON.stringify({ type: 'image', data: Buffer.alloc(bytes, 147).toString('base64') }) + '\n');
const wrapped =
  Buffer.from('ordinary image contents '.repeat(6000))
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\n') + '\n';
for (const [name, input, width] of [...images.map((image, index) => [index === 0 ? 'image' : `image-${index}`, image, 4096]), ['wrapped', wrapped, 77]]) {
  const stream = createCredentialStreamSanitizer({ includeEnvironmentCredentials: false });
  const start = performance.now();
  let output = '';
  for (let at = 0; at < input.length; at += width) output += stream.write(input.slice(at, at + width));
  output += stream.flush();
  const ms = Math.round(performance.now() - start);
  const preserved = output === input;
  console.log(JSON.stringify({ name, length: input.length, ms, preserved }));
  assert.ok(preserved, `${name} must preserve every noncredential byte`);
  assert.ok(ms < 10000, `${name} must drain promptly`);
}
