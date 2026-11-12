// Upstream link-foundation/sensitive-data-sanitizer#170: on Node, 0.20.0–0.22.2
// fail with ERR_SANITIZATION on one long mixed-case letter run (a single-line
// base64 blob in a JSONL log) of about 8 MiB or more. Fixed in 0.22.3.
//
// Usage (synthetic data only, finite sizes):
//   node --max-old-space-size=1024 experiments/issue-3739/long-letter-run-probe.mjs [library dir]
// Without an argument the installed library and Hive Mind's own paths are probed;
// with a directory (e.g. an unpacked 0.22.1) only that library is probed.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const MiB = 1024 * 1024;
const SECRET = 'xx-private-value-0123456789';
const sample = runBytes => `${'Ab'.repeat(runBytes / 2)}\npassword=${SECRET}\n`;
const report = (name, started, fn) => {
  try {
    const out = fn();
    console.log(JSON.stringify({ name, ok: true, secretRemoved: !out.includes(SECRET), elapsedMs: Date.now() - started }));
  } catch (error) {
    console.log(JSON.stringify({ name, ok: false, code: error.code || error.name, elapsedMs: Date.now() - started }));
  }
};

const libraryDir = process.argv[2];
if (libraryDir) {
  const require = createRequire(path.join(path.resolve(libraryDir), 'package.json'));
  const { createSyncSanitizer } = require('./src/credentials-entry.js');
  const sanitizer = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } });
  for (const size of [4 * MiB, 15 * MiB]) {
    const text = sample(size);
    report(`library ${path.basename(libraryDir)} ${size / MiB} MiB`, Date.now(), () => sanitizer.sanitize(text).text);
  }
} else {
  const { sanitizeCredentialText } = await import('../../src/credential-sanitization-core.lib.mjs');
  const { sanitizeLogFileToFile } = await import('../../src/log-sanitize-stream.lib.mjs');
  for (const size of [4 * MiB, 15 * MiB]) {
    const text = sample(size);
    report(`sanitizeCredentialText ${size / MiB} MiB`, Date.now(), () => sanitizeCredentialText(text));
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-letter-run-'));
  try {
    const sourcePath = path.join(dir, 'in.log');
    const destPath = path.join(dir, 'out.log');
    await fs.writeFile(sourcePath, `{"type":"image","data":"${'Ab'.repeat(8 * MiB)}"}\npassword=${SECRET}\n`);
    const started = Date.now();
    try {
      await sanitizeLogFileToFile({ sourcePath, destPath });
      const out = await fs.readFile(destPath, 'utf8');
      console.log(JSON.stringify({ name: 'sanitizeLogFileToFile 16 MiB line', ok: true, secretRemoved: !out.includes(SECRET), elapsedMs: Date.now() - started }));
    } catch (error) {
      console.log(JSON.stringify({ name: 'sanitizeLogFileToFile 16 MiB line', ok: false, code: error.code || error.name, elapsedMs: Date.now() - started }));
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
