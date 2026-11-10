/** Audit remaining prose at prompt and feedback construction boundaries. */
import { readFile, readdir } from 'node:fs/promises';
import { URL } from 'node:url';
import console from 'node:console';
import { parse } from '@babel/parser';

for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (!name.endsWith('.mjs')) continue;
  const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module' });
  function visit(node, scope = '') {
    if (!node?.type || node.type === 'ImportDeclaration' || node.type === 'TaggedTemplateExpression') return;
    if (node.type === 'FunctionDeclaration') scope = node.id?.name || scope;
    if (node.type === 'VariableDeclarator' && /FunctionExpression/.test(node.init?.type || '')) scope = node.id.name || scope;
    const value = node.type === 'StringLiteral' ? node.value : node.type === 'TemplateLiteral' ? node.quasis.map(part => part.value.cooked).join('{{value}}') : '';
    if ((name.endsWith('.prompts.lib.mjs') || /Prompt|Feedback|Instruction|Guidance|Hint/.test(scope)) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(value)) console.log(`${name}:${node.loc.start.line} ${scope}: ${JSON.stringify(value)}`);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(entry => visit(entry, scope));
      else if (child?.type) visit(child, scope);
    }
  }
  visit(ast.program);
}
