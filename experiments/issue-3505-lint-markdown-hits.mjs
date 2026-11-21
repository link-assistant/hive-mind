// Issue #3505: run the new no-unescaped-telegram-markdown rule over src/ (no
// baseline) and list every hit, to audit them.
// Usage: node experiments/issue-3505-lint-markdown-hits.mjs [files...]
import { ESLint } from 'eslint';
import rule from '../eslint-rules/no-unescaped-telegram-markdown.mjs';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{ files: ['**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module' }, plugins: { t: { rules: { r: rule } } }, rules: { 't/r': 'error' } }],
});
const results = await eslint.lintFiles(process.argv.slice(2).length ? process.argv.slice(2) : ['src/**/*.mjs']);
let total = 0;
for (const result of results) {
  // Only this rule: the isolated config also reports unused disable directives
  // and rules it does not load.
  for (const message of result.messages.filter(item => item.ruleId === 't/r' || item.fatal)) {
    total++;
    console.log(`${result.filePath.replace(process.cwd() + '/', '')}:${message.line}:${message.column} ${message.message.split(' is interpolated')[0]}${message.fatal ? ' FATAL ' + message.message : ''}`);
  }
}
console.log(`total: ${total}`);
