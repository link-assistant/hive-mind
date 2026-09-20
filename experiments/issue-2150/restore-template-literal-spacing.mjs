#!/usr/bin/env node

// Restores template-literal whitespace after the mechanical line-headroom pass.
// The compaction intentionally removes source-only blank lines, but blank lines
// inside template literals are runtime data and must remain byte-for-byte equal.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { parse } from 'acorn';

const sourceRoots = ['src', 'tests'];
const normalizeBlankLines = value =>
  value
    .split('\n')
    .filter(line => line.trim() !== '')
    .join('\n');

const collectTemplates = (source, file) => {
  const templates = [];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'TemplateLiteral') {
      templates.push({
        file,
        quasis: node.quasis.map(quasi => ({
          start: quasi.start,
          end: quasi.end,
          raw: quasi.value.raw,
        })),
      });
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  };

  visit(ast);
  return templates;
};

const signature = template => JSON.stringify(template.quasis.map(quasi => normalizeBlankLines(quasi.raw)));
const exactValue = template => JSON.stringify(template.quasis.map(quasi => quasi.raw));

const baseFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', ...sourceRoots], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(file => file.endsWith('.mjs'));

const baseBySignature = new Map();
for (const file of baseFiles) {
  const source = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' });
  for (const template of collectTemplates(source, file)) {
    const key = signature(template);
    const candidates = baseBySignature.get(key) ?? [];
    candidates.push(template);
    baseBySignature.set(key, candidates);
  }
}

const currentFiles = execFileSync('find', [...sourceRoots, '-type', 'f', '-name', '*.mjs'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

let restoredTemplates = 0;
for (const file of currentFiles) {
  let source = fs.readFileSync(file, 'utf8');
  const replacements = [];

  for (const template of collectTemplates(source, file)) {
    const candidates = baseBySignature.get(signature(template)) ?? [];
    const currentExact = exactValue(template);
    if (candidates.some(candidate => exactValue(candidate) === currentExact)) continue;

    const variants = new Map(candidates.map(candidate => [exactValue(candidate), candidate]));
    if (variants.size === 0) continue; // Newly introduced template literal.
    if (variants.size !== 1) {
      throw new Error(`Ambiguous original template value in ${file}: ${signature(template)}`);
    }

    const [original] = variants.values();
    if (original.quasis.length !== template.quasis.length) {
      throw new Error(`Template arity changed unexpectedly in ${file}`);
    }

    template.quasis.forEach((quasi, index) => {
      if (source.slice(quasi.start, quasi.end) !== quasi.raw) {
        throw new Error(`Acorn range mismatch in ${file}:${quasi.start}`);
      }
      replacements.push({
        start: quasi.start,
        end: quasi.end,
        value: original.quasis[index].raw,
      });
    });
    restoredTemplates += 1;
  }

  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, replacement.start) + replacement.value + source.slice(replacement.end);
  }
  if (replacements.length > 0) fs.writeFileSync(file, source);
}

console.log(`Restored ${restoredTemplates} template literals.`);
