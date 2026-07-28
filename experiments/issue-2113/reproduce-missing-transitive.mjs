#!/usr/bin/env node

/**
 * Issue #2113: reproduce the production ERR_MODULE_NOT_FOUND shape without
 * npm or network access, then demonstrate the shared use-m retry recovery.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { useWithRetry } from '../../src/use-with-retry.lib.mjs';

const root = await mkdtemp(join(tmpdir(), 'hive-mind-issue-2113-'));
const aliasDir = join(root, 'command-stream-v-latest');
const entry = join(aliasDir, 'src', '$.mjs');
const missing = join(aliasDir, 'src', 'terminal-capture.mjs');

const install = async ({ complete }) => {
  await mkdir(join(aliasDir, 'src'), { recursive: true });
  await writeFile(entry, "export { capture } from './terminal-capture.mjs';\n");
  if (complete) await writeFile(missing, "export const capture = () => 'recovered';\n");
};

try {
  await install({ complete: false });
  let rawError;
  try {
    await import(pathToFileURL(entry));
  } catch (error) {
    rawError = new Error(`Failed to import module from '${entry}'.`, { cause: error });
  }
  assert.equal(rawError.cause.code, 'ERR_MODULE_NOT_FOUND');
  process.stdout.write(`reproduced: ${rawError.message}\n`);
  process.stdout.write(`caused by: ${rawError.cause.code}: ${rawError.cause.message}\n`);

  let attempt = 0;
  const recovered = await useWithRetry(
    async () => {
      attempt++;
      if (attempt === 1) throw rawError;
      return import(`${pathToFileURL(entry).href}?attempt=${attempt}`);
    },
    'command-stream',
    {
      cleanup: async path => {
        assert.equal(path, aliasDir);
        await rm(path, { recursive: true, force: true });
        await install({ complete: true });
      },
    }
  );
  assert.equal(recovered.capture(), 'recovered');
  process.stdout.write(`recovered on attempt ${attempt}: ${recovered.capture()}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
