/** Reuse the project's existing translations, retaining English for new text. */
import { readFile, writeFile } from 'node:fs/promises';
import { loadLocaleFromFile, formatLinoCatalog } from 'lino-i18n';

const folders = ['locales/prompts', 'locales/prompts/system'];
for (const locale of ['ru', 'zh', 'hi']) {
  const lines = new Map();
  const exact = new Map();
  for (const folder of folders) {
    const english = (await loadLocaleFromFile(`${folder}/en.lino`)).translations;
    const translated = (await loadLocaleFromFile(`${folder}/${locale}.lino`)).translations;
    for (const [key, value] of Object.entries(english)) {
      const target = translated[key];
      if (!target) continue;
      exact.set(value, target);
      const sourceLines = value.split('\n');
      const targetLines = target.split('\n');
      if (sourceLines.length !== targetLines.length) continue;
      sourceLines.forEach((line, index) => {
        if (line.trim()) lines.set(line.trim(), targetLines[index].trim());
      });
    }
  }
  for (const folder of folders) {
    for (const module of ['templates', 'additional']) {
      const english = (await loadLocaleFromFile(`${folder}/${module}.en.lino`)).translations;
      const translated = {};
      for (const [key, value] of Object.entries(english)) {
        let text =
          exact.get(value) ||
          value
            .split('\n')
            .map(line => {
              const target = lines.get(line.trim());
              return target ? line.match(/^\s*/)[0] + target : line;
            })
            .join('\n');
        if (key.includes('.RESOURCE_AWARE_SOLVER_IDENTITY.')) {
          text = { ru: 'Предпочитай минимальное локальное использование CPU, памяти и диска.', zh: '优先尽量减少本地 CPU、内存和磁盘使用。', hi: 'स्थानीय CPU, मेमोरी और डिस्क का न्यूनतम उपयोग पसंद करें।' }[locale];
        }
        if (text !== value) translated[key] = text;
      }
      if (Object.keys(translated).length) await writeFile(`${folder}/${module}.${locale}.lino`, formatLinoCatalog(locale, translated));
    }
  }
}
