// Verify preserved captures without loading whole incident logs into memory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = 'docs/case-studies/issue-2613/evidence';
let verified = 0;
for (const relativeManifest of ['log-manifest.json', 'ci/manifest.json', 'validation/manifest.json']) {
  const manifestPath = path.join(root, relativeManifest);
  const entries = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const entry of entries) {
    const file = path.join(path.dirname(manifestPath), entry.file);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    assert.equal(digest.digest('hex'), entry.sha256, `${file}: checksum mismatch`);
    assert.equal((await stat(file)).size, entry.bytes, `${file}: size mismatch`);
    verified++;
  }
}
console.log(`Verified ${verified} preserved captures against their size and SHA-256 manifests`);
