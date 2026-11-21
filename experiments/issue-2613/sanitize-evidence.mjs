// Preserve diagnostic meaning while applying the same publication sanitizer as
// runtime attachments. Originals remain local under the ignored experiments log.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sanitizeLogFileToFileBounded } from '../../src/log-sanitize-worker.lib.mjs';

const root = 'docs/case-studies/issue-2613/evidence';
const originals = 'experiments/issue-2613/original-logs';
await fs.mkdir(originals, { recursive: true });
const manifest = [];
for (const name of (await fs.readdir(root)).filter(name => name.endsWith('.log'))) {
  const sourcePath = path.join(root, name);
  const original = path.join(originals, name);
  await fs.copyFile(sourcePath, original);
  const originalSha256 = createHash('sha256')
    .update(await fs.readFile(original))
    .digest('hex');
  const destination = `${sourcePath}.sanitized`;
  const stats = await sanitizeLogFileToFileBounded({ sourcePath, destPath: destination });
  await fs.rename(destination, sourcePath);
  manifest.push({ file: name, originalSha256, stats });
}
await fs.writeFile(path.join(root, 'publication-sanitization.json'), JSON.stringify(manifest, null, 2) + '\n');
