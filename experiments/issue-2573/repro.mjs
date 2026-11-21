// Issue #2573 reproduction: `fix --ci-cd` has no C/C++ template.
// Usage: node experiments/issue-2573/repro.mjs [hive-mind checkout] [languages.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const [root = `${here}../..`, languagesFile = `${here}interfaces-languages.json`] = process.argv.slice(2);
const lib = await import(pathToFileURL(`${root}/src/fix.ci-cd.lib.mjs`).href);
const languages = JSON.parse(readFileSync(languagesFile, 'utf8'));
const { sortedTemplates, unmatchedLanguages } = lib.mapLanguagesToTemplates(languages);
console.log(
  'templates:',
  sortedTemplates.map(entry => entry.template.repo)
);
console.log('unmatched:', unmatchedLanguages);
