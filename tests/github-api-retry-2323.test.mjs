/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubApi } from '../scripts/github-api.lib.mjs';

test('GitHub fixture API retains transient retries and never retries permission errors', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'github-api-retry-'));
  const count = join(directory, 'calls');
  const originalPath = process.env.PATH;
  const installGh = error => {
    writeFileSync(count, '0');
    writeFileSync(join(directory, 'gh'), `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst count = ${JSON.stringify(count)};\nconst calls = Number(fs.readFileSync(count, 'utf8')) + 1;\nfs.writeFileSync(count, String(calls));\nif (calls === 1) { console.error(${JSON.stringify(error)}); process.exit(1); }\nconsole.log(JSON.stringify({ ok: true }));\n`, { mode: 0o755 });
  };
  process.env.PATH = `${directory}:${originalPath}`;
  try {
    installGh('HTTP 502: Bad Gateway');
    const options = { retryOptions: { transientDelay: 0, transientMaxAttempts: 2, log: () => {} } };
    assert.deepEqual(await githubApi('repos/test/fixture', options), { ok: true });
    assert.equal(readFileSync(count, 'utf8'), '2');
    installGh('HTTP 403: Resource not accessible by integration');
    await assert.rejects(githubApi('repos/test/fixture', options), /403/);
    assert.equal(readFileSync(count, 'utf8'), '1', 'permissions must remain visible failures');
  } finally {
    process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
