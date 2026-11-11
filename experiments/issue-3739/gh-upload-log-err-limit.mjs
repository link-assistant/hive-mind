// Reproduce `Sanitization failed (ERR_LIMIT)` of gh-upload-log (router PR #785).
// Runs only gh-upload-log's pre-upload sanitization with a no-op upload, so
// nothing is published. Usage:
//   bun experiments/issue-3739/gh-upload-log-err-limit.mjs <gh-upload-log dir> <work dir> [case...]
// Cases are generated synthetic logs; no real credential is used.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [packageDir, workDir, ...selected] = process.argv.slice(2);
if (!packageDir || !workDir) {
  console.error('usage: <gh-upload-log dir> <work dir> [case...]');
  process.exit(2);
}
const { withSanitizedUpload } = await import(pathToFileURL(path.join(packageDir, 'src', 'sanitization.js')).href);
const base64Line = index => Buffer.from(`synthetic payload ${index} `.repeat(4)).toString('base64');
const cases = {
  // One record larger than gh-upload-log's 64 MiB MAX_RECORD_BYTES.
  'line-over-64mib': () => `{"type":"item","text":"${'a '.repeat(33 * 1024 * 1024)}"}\n`,
  // A 20 MiB record, under the limit.
  'line-20mib': () => `{"type":"item","text":"${'a '.repeat(10 * 1024 * 1024)}"}\n`,
  // Upstream sensitive-data-sanitizer #139: many base64 lines.
  'base64-lines-5000': () => Array.from({ length: 5000 }, (_, i) => base64Line(i)).join('\n') + '\n',
  // Upstream #139: many identifier lines (git rev-list output).
  'hex-lines-20000': () => Array.from({ length: 20000 }, (_, i) => (i.toString(16).padStart(8, '0') + 'f'.repeat(32)).slice(0, 40)).join('\n') + '\n',
  // Hive Mind-style masks already present in a sanitized log.
  'masks-200000': () => Array.from({ length: 200000 }, (_, i) => `line ${i} token ghp…b4N and Bearer 012…567`).join('\n') + '\n',
};
// `base64-lines-<N>` generates N base64 lines, to find where the detector limit starts.
for (const name of selected) {
  const count = /^base64-lines-(\d+)$/.exec(name)?.[1];
  if (count && !cases[name]) cases[name] = () => Array.from({ length: Number(count) }, (_, i) => base64Line(i)).join('\n') + '\n';
}
fs.mkdirSync(workDir, { recursive: true });
for (const name of selected.length ? selected : Object.keys(cases)) {
  const file = path.join(workDir, `${name}.log`);
  fs.writeFileSync(file, cases[name]());
  const started = Date.now();
  try {
    await withSanitizedUpload({ filePath: file }, async () => ({ success: true }));
    console.log(`${name}: ok (${fs.statSync(file).size} bytes, ${Date.now() - started} ms)`);
  } catch (error) {
    console.log(`${name}: ${error.message} [cause ${error.cause?.code || error.cause?.message}${process.env.SHOW_STACK ? `\n${error.cause?.stack}` : ''}] (${fs.statSync(file).size} bytes, ${Date.now() - started} ms)`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
