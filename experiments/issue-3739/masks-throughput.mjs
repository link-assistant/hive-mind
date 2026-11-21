// Time Hive Mind's own streamed sanitize and the plain library file API on
// 200,000 lines of existing masks (the slow gh-upload-log case).
// Usage: node experiments/issue-3739/masks-throughput.mjs <work dir>
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeFileToFile } from '@link-foundation/sensitive-data-sanitizer';
import { sanitizeLogFileToFileBounded } from '../../src/log-sanitize-worker.lib.mjs';

const workDir = process.argv[2];
fs.mkdirSync(workDir, { recursive: true });
const source = path.join(workDir, 'masks.log');
fs.writeFileSync(source, Array.from({ length: 200000 }, (_, i) => `line ${i} token ghp…b4N and Bearer 012…567`).join('\n') + '\n');
const time = async (name, run) => {
  const started = Date.now();
  await run(path.join(workDir, `${name}.out`));
  console.log(`${name}: ${Date.now() - started} ms`);
};
await time('hive-mind', dest => sanitizeLogFileToFileBounded({ sourcePath: source, destPath: dest }));
await time('library-file-api', dest => sanitizeFileToFile(source, dest, { allowBinary: true, maxRecordBytes: 64 * 1024 * 1024, maxTotalBytes: fs.statSync(source).size, sanitizerOptions: { credentialsOnly: true } }));
fs.rmSync(workDir, { recursive: true, force: true });
