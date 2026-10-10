// Extract attribution evidence without loading the complete archived logs.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

for (const name of ['meta-theory-2026-06-05-session.log.gz', 'meta-theory-2026-10-05-session.log.gz', 'meta-theory-final-session.log.gz']) {
  const input = createReadStream(new URL(`../../docs/case-studies/issue-2549/data/${name}`, import.meta.url)).pipe(createGunzip());
  let lineNumber = 0;
  let matches = 0;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    lineNumber++;
    if (/^\[.*\] .*PR description Changes section regenerated from the diff/.test(line)) {
      matches++;
      console.log(`${name}:${lineNumber}: ${line}`);
    }
  }
  console.log(`${name}: ${lineNumber} lines; ${matches} finalizer attribution records`);
}
