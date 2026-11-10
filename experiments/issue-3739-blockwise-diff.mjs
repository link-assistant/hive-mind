// Issue #3739: compare whole-text sanitizeForPublication with the block-wise
// sanitizeLogFileToFile on the #2189 corpus and print the first differing lines.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';
const PEM_BLOCK = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEAx7Xn3Qd8xkq0Zk1Yy3Yh5c9wKq2r0lVn8yQ3mB1s6cT4uW9v', 'Zk1Yy3Yh5c9wKq2r0lVn8yQ3mB1s6cT4uW9vMIIEowIBAAKCAQEAx7Xn3Qd8xkq0', '-----END RSA PRIVATE KEY-----'].join('\n');
const lines = [];
for (let i = 0; i < 900; i++) {
  lines.push(`[2026-09-02T13:0${i % 10}:00Z] worker ${i} processing task ${i} with a reasonably long line of transcript text`);
  if (i % 120 === 17) lines.push(`  token leak ghp_${'A1b2C3d4E5'.repeat(3)}6789 in the middle of the transcript`);
  if (i % 200 === 31) lines.push(`  aws access key AKIA${'QWERTYUIOP'.repeat(1)}ASDF used by the tool`);
  if (i % 300 === 44) lines.push(PEM_BLOCK);
}
const corpus = `${lines.join('\n')}\n`;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3739-'));
await fs.writeFile(path.join(dir, 'c.log'), corpus);
const whole = await sanitizeForPublication(corpus);
await sanitizeLogFileToFile({ sourcePath: path.join(dir, 'c.log'), destPath: path.join(dir, 'o.log'), chunkBytes: 4096 });
const streamed = await fs.readFile(path.join(dir, 'o.log'), 'utf8');
const a = whole.split('\n'), b = streamed.split('\n');
let shown = 0;
for (let i = 0; i < Math.max(a.length, b.length) && shown < 10; i++) if (a[i] !== b[i]) { console.log(i, '\n whole:', JSON.stringify(a[i]), '\n strm: ', JSON.stringify(b[i])); shown++; }
console.log('identical:', whole === streamed);
await fs.rm(dir, { recursive: true });
