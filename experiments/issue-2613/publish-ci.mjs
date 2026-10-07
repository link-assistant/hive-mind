// Preserve complete failed-run logs with the runtime publication sanitizer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sanitizeLogFileToFileBounded } from '../../src/log-sanitize-worker.lib.mjs';

const source = 'ci-logs';
const destination = 'docs/case-studies/issue-2613/evidence/ci';
await fs.mkdir(destination, { recursive: true });
const manifest = [];
for (const name of (await fs.readdir(source)).filter(name => /^(checks-and-release-\d+\.log|detect-changes-\d+\.log|release-latest\.json|latest-runs\.json)$/.test(name)).sort()) {
  const target = path.join(destination, name);
  const temporary = `${target}.sanitized`;
  await fs.rm(temporary, { force: true });
  const stats = await sanitizeLogFileToFileBounded({ sourcePath: path.join(source, name), destPath: temporary });
  await fs.rename(temporary, target);
  const published = await fs.readFile(target);
  manifest.push({ file: name, bytes: published.length, sha256: createHash('sha256').update(published).digest('hex'), stats });
}
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Published ${manifest.length} sanitized CI captures`);
