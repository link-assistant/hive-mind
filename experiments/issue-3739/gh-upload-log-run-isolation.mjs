// Upstream sensitive-data-sanitizer#172 makes gh-upload-log 0.13.2 refuse a log
// with a ~4 MiB letter run next to non-ASCII text. This splits such a log with
// Hive Mind's part splitter and runs gh-upload-log's pre-upload sanitization on
// the whole file and on every part (no-op upload, nothing is published). Usage:
//   node experiments/issue-3739/gh-upload-log-run-isolation.mjs <gh-upload-log dir> <work dir>
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitLogIntoLineAlignedParts } from '../../src/log-upload.lib.mjs';

const [packageDir, workDir] = process.argv.slice(2);
if (!packageDir || !workDir) {
  console.error('usage: <gh-upload-log dir> <work dir>');
  process.exit(2);
}
const { withSanitizedUpload } = await import(pathToFileURL(path.join(packageDir, 'src', 'sanitization.js')).href);
const MiB = 1024 * 1024;
const check = async file => {
  const started = Date.now();
  const { size } = await fs.stat(file);
  try {
    await withSanitizedUpload({ filePath: file }, async () => ({ success: true }));
    return `ok (${size} bytes, ${Date.now() - started} ms)`;
  } catch (error) {
    return `${error.message} (${size} bytes, ${Date.now() - started} ms)`;
  }
};
await fs.mkdir(workDir, { recursive: true });
const source = path.join(workDir, 'session.log');
await fs.writeFile(source, `✅ step started — ok\n{"type":"image","data":"${'A'.repeat(6 * MiB)}"}\n🔐 token refreshed\n${'ascii log line\n'.repeat(1000)}`);
console.log('whole:', await check(source));
const stats = {};
const parts = await splitLogIntoLineAlignedParts({ sourcePath: source, directory: workDir, stats });
console.log(`split: ${parts.length} parts, ${stats.isolatedRuns} isolating cut(s)`);
for (const part of parts) console.log(`${path.basename(part)}:`, await check(part));
await fs.rm(workDir, { recursive: true, force: true });
