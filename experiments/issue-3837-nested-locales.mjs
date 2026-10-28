/** Bounded reproducer for lino-i18n's non-recursive directory loader. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadLocalesFromDirectory } from 'lino-i18n/loaders';

const directory = await mkdtemp(path.join(tmpdir(), 'hive-nested-locales-'));
try {
  await mkdir(path.join(directory, 'prompts/system'), { recursive: true });
  await writeFile(path.join(directory, 'en.lino'), 'en\n  ui "UI"\n');
  await writeFile(path.join(directory, 'prompts/system/en.lino'), 'en\n  instruction "System instructions"\n');
  const result = await loadLocalesFromDirectory(directory, { recursive: true });
  assert.equal(result.en.ui, 'UI');
  assert.equal(result.en.instruction, undefined);
  console.log('Confirmed with lino-i18n 0.4.0: recursive: true still ignores prompts/system/en.lino.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
