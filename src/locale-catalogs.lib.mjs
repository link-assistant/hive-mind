/** Temporary recursive-loader adapter; https://github.com/link-foundation/lino-i18n/issues/35. */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadLocalesFromDirectory } from 'lino-i18n/loaders';

export async function loadLocaleTree(directory, options = {}) {
  const catalogues = await loadLocalesFromDirectory(directory, options);
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const children = await loadLocaleTree(path.join(directory, entry.name), options);
    for (const [locale, translations] of Object.entries(children)) {
      const target = (catalogues[locale] ??= {});
      for (const [key, value] of Object.entries(translations)) {
        if (Object.hasOwn(target, key) && target[key] !== value) throw new Error(`Conflicting locale key ${locale}:${key} in ${directory}`);
        target[key] = value;
      }
    }
  }
  return catalogues;
}
