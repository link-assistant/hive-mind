// Publish local validation captures using the runtime attachment sanitizer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sanitizeLogFileToFileBounded } from '../../src/log-sanitize-worker.lib.mjs';

const source = 'experiments/issue-2613';
const destination = 'docs/case-studies/issue-2613/evidence/validation';
await fs.mkdir(destination, { recursive: true });
const manifest = [];
for (const name of (await fs.readdir(source)).filter(name => name.endsWith('.log')).sort()) {
  const target = path.join(destination, name);
  const stats = await sanitizeLogFileToFileBounded({ sourcePath: path.join(source, name), destPath: target });
  const published = await fs.readFile(target);
  manifest.push({ file: name, bytes: published.length, sha256: createHash('sha256').update(published).digest('hex'), stats });
}
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Published ${manifest.length} sanitized local captures`);
