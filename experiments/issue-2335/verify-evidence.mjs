/** Verify this case's finite archive, publication scan and Markdown links. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const root = new URL('../../', import.meta.url);
const data = new URL('docs/case-studies/issue-2335/data/', root);
const sha256 = content => createHash('sha256').update(content).digest('hex');
const manifests = ['agent-ci-manifest.json'];
let checkedLogs = 0;
for (const file of manifests) {
  const manifest = JSON.parse(await readFile(new URL(file, data), 'utf8'));
  for (const entry of Array.isArray(manifest) ? manifest : manifest.logs) {
    assert.equal(entry.unavailable, undefined, entry.file);
    const compressed = await readFile(new URL(entry.file, data));
    const content = gunzipSync(compressed, { maxOutputLength: 40 * 1024 * 1024 });
    assert.equal(sha256(content), entry.uncompressedSha256, entry.file);
    checkedLogs++;
  }
}

const credentials = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-[A-Za-z0-9_-]{40,}|AIza[A-Za-z0-9_-]{30,}|\b\d{8,12}:[A-Za-z0-9_-]{30,})/;
const inventory = [];
for (const file of (await readdir(data)).sort()) {
  if (file === 'evidence-manifest.json') continue;
  const raw = await readFile(new URL(file, data));
  const content = file.endsWith('.gz') ? gunzipSync(raw, { maxOutputLength: 40 * 1024 * 1024 }) : raw;
  assert.equal(credentials.test(content.toString()), false, `Credential-shaped content in ${file}`);
  if (file.endsWith('.json')) JSON.parse(content.toString());
  inventory.push({ file, bytes: raw.length, sha256: sha256(raw) });
}

for (const path of ['docs/case-studies/issue-2335/README.md']) {
  const source = new URL(path, root);
  for (const [, target] of (await readFile(source, 'utf8')).matchAll(/\]\(([^)]+)\)/g)) {
    if (target.includes('://') || target.startsWith('#')) continue;
    await readFile(new URL(decodeURIComponent(target.split('#')[0].split('?')[0]), source));
  }
}

const manifestPath = new URL('evidence-manifest.json', data);
if (process.argv.includes('--write-manifest')) await writeFile(manifestPath, `${JSON.stringify(inventory, null, 2)}\n`);
else assert.deepEqual(inventory, JSON.parse(await readFile(manifestPath, 'utf8')));
console.log(`Verified ${checkedLogs} compressed logs, ${inventory.length} archive files, and all case-study local links.`);
