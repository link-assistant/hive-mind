/** Move the remaining connection/resume messages without translating protocol tokens. */
import { readFile, writeFile } from 'node:fs/promises';
import { loadLocaleFromFile, formatLinoCatalog } from 'lino-i18n';
const file = 'locales/prompts/additional.en.lino';
const values = (await loadLocaleFromFile(file)).translations;
values['prompt.templates.connection.greeting'] = 'hi';
values['prompt.templates.connection.codexProbe'] = 'hive-mind capability probe';
await writeFile(file, formatLinoCatalog('en', values));
for (const name of ['agent.lib.mjs', 'opencode.lib.mjs', 'claude.connection.lib.mjs', 'codex-capability-preflight.lib.mjs']) {
  const file = `src/${name}`;
  let source = await readFile(file, 'utf8');
  source = source.replaceAll('printf "hi" |', "printf %s ${promptText('prompt.templates.connection.greeting', {}, { locale: 'en' })} |");
  source = source.replace(' -p hi`;', " -p ${promptText('prompt.templates.connection.greeting', {}, { locale: 'en' })}`;");
  source = source.replace("'debug', 'prompt-input', 'hive-mind capability probe'", "'debug', 'prompt-input', promptText('prompt.templates.connection.codexProbe', {}, { locale: 'en' })");
  const declaration = "import { promptText } from './prompt-text.lib.mjs';\n";
  source = source.startsWith('#!') ? source.replace(/^(#![^\n]*\n)/, '$1' + declaration) : declaration + source;
  await writeFile(file, source);
}
const resume = 'src/claude.command-builder.lib.mjs';
let source = await readFile(resume, 'utf8');
source = source.replace('\n', "\nimport { promptText } from './prompt-text.lib.mjs';\nimport { shellQuote } from './shell-command.lib.mjs';\n");
source = source.replace('args += ` -p "Continue."`;', "args += ` -p ${shellQuote(promptText('prompt.user_continue'))}`;");
await writeFile(resume, source);
