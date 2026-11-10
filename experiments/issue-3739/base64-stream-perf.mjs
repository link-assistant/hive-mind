// Finite resource-light reproduction of #3747; no source data is printed.
import { performance } from 'node:perf_hooks';
import { createCredentialStreamSanitizer } from '../../src/credential-sanitization-core.lib.mjs';
const image = JSON.stringify({ type: 'image', data: Buffer.alloc(150000, 147).toString('base64') }) + '\n';
const wrapped =
  Buffer.from('ordinary image contents '.repeat(6000))
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\n') + '\n';
for (const [name, input, width] of [
  ['image', image, 4096],
  ['wrapped', wrapped, 77],
]) {
  const stream = createCredentialStreamSanitizer({ includeEnvironmentCredentials: false });
  const start = performance.now();
  let output = '';
  for (let at = 0; at < input.length; at += width) output += stream.write(input.slice(at, at + width));
  output += stream.flush();
  console.log(JSON.stringify({ name, length: input.length, ms: Math.round(performance.now() - start), preserved: output === input }));
}
