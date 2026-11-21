/** One-off follow-up to the AST extraction: retain protocols and catalog placement. */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { loadLocalesFromFile, formatLinoCatalog } from 'lino-i18n';

const locations = ['locales/prompts/templates.en.lino', 'locales/prompts/system/templates.en.lino', 'locales/prompts/additional.en.lino', 'locales/prompts/system/additional.en.lino'];
const records = new Map();
for (const file of locations) records.set(file, (await loadLocalesFromFile(file))[0].translations);
const all = Object.assign({}, ...records.values());
const changes = new Map();
const removed = new Set();
for (const [key, value] of Object.entries(all)) {
  if (/organize-prompts\.chunkOrganizationIssues|issue-completion-prompts\.REQUIREMENTS_(START|END)/.test(key)) {
    removed.add(key);
    continue;
  }
  if (key.startsWith('prompt.system.') && /task\.runClarifyOrDecomposeMode\.text[14]$|organize-prompts\.buildOrganizationPrompts|handoff-prompts\.(?:HANDOFF_SKILL_DESCRIPTION|buildHandoffSkillBody|buildHandoffSkillFile)|fix-ci-cd\./.test(key)) changes.set(key, key.replace('prompt.system.', 'prompt.'));
}
for (const name of (await readdir('src')).filter(name => name.endsWith('.mjs'))) {
  const file = `src/${name}`;
  let source = await readFile(file, 'utf8');
  if (!source.includes("from './prompt-text.lib.mjs'")) continue;
  const ast = parse(source, { sourceType: 'module' });
  const edits = [];
  function walk(node) {
    if (!node?.type) return;
    if (node.type === 'CallExpression' && node.callee.name === 'promptText' && node.arguments[0]?.type === 'StringLiteral') {
      const [keyNode, parameters] = node.arguments;
      const key = keyNode.value;
      if (removed.has(key)) {
        edits.push({ start: node.start, end: node.end, text: JSON.stringify(all[key]) });
        return;
      }
      if (parameters?.type === 'ObjectExpression' && Object.hasOwn(all, key)) {
        const seen = new Map();
        const properties = [];
        for (const property of parameters.properties) {
          const expression = property.value;
          const value = expression?.type === 'CallExpression' && expression.callee.name === 'String' && expression.arguments.length === 1 && expression.arguments[0].type === 'Identifier' ? expression.arguments[0].name : null;
          const parameter = property.key.name || property.key.value;
          if (value && seen.has(value)) all[key] = all[key].replaceAll(`{{${parameter}}}`, `{{${seen.get(value)}}}`);
          else {
            if (value) seen.set(value, parameter);
            properties.push(source.slice(property.start, property.end));
          }
        }
        edits.push({ start: parameters.start, end: parameters.end, text: `{ ${properties.join(', ')} }` });
      }
      if (changes.has(key)) edits.push({ start: keyNode.start, end: keyNode.end, text: JSON.stringify(changes.get(key)) });
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child?.type) walk(child);
    }
  }
  walk(ast.program);
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  await writeFile(file, source);
}
for (const values of records.values()) for (const key of Object.keys(values)) delete values[key];
for (const [oldKey, value] of Object.entries(all)) {
  if (removed.has(oldKey)) continue;
  const key = changes.get(oldKey) || oldKey;
  const file = `locales/prompts/${key.startsWith('prompt.system.') ? 'system/' : ''}${key.includes('.templates.review.') || key.includes('.templates.task.') || key.includes('.templates.solve-feedback.') || key.includes('.templates.solve-issue-completion.') || key.includes('.templates.solve-auto-merge.') || key.includes('.templates.agent-commander.') ? 'additional' : 'templates'}.en.lino`;
  records.get(file)[key] = value;
}
const user = records.get('locales/prompts/additional.en.lino');
user['prompt.templates.connection.gemini'] = 'say hi';
user['prompt.templates.connection.qwen'] = 'Respond with exactly: hi';
user['prompt.templates.feedback.continue'] = 'Continue';
user['prompt.templates.feedback.restartIteration'] = ' (Auto-restart {{restartCount}}/{{maxIterations}})';
for (const [file, values] of records) await writeFile(file, formatLinoCatalog('en', values));
