/** Bounded before/after probe for lino-i18n's opt-in recursive directory loader. */
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
  const flat = await loadLocalesFromDirectory(directory);
  assert.equal(flat.en.instruction, undefined);
  const result = await loadLocalesFromDirectory(directory, { recursive: true });
  assert.equal(result.en.ui, 'UI');
  assert.equal(result.en.instruction, 'System instructions');
  console.log('Confirmed with the installed lino-i18n: recursive: true loads prompts/system/en.lino; the default remains flat.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
