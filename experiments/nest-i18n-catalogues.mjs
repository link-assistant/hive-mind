#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadLocalesFromFile } from 'lino-i18n/loaders';

const localeFiles = ['en', 'ru', 'zh', 'hi'].map(locale => ({
  locale,
  filePath: path.join('src', 'locales', `${locale}.lino`),
}));

function createNode() {
  return {
    value: undefined,
    children: new Map(),
  };
}

function childNode(node, key) {
  if (!node.children.has(key)) {
    node.children.set(key, createNode());
  }
  return node.children.get(key);
}

function insertDottedKey(root, key, value) {
  const parts = key.split('.');
  let node = root;
  for (const part of parts) {
    node = childNode(node, part);
  }
  node.value = value;
}

function insertTokenPath(root, tokens, value) {
  let node = root;
  for (const token of tokens) {
    node = childNode(node, token);
  }
  node.value = value;
}

function groupChildren(children) {
  const trie = createNode();
  for (const [key, value] of children) {
    insertTokenPath(trie, key.split('_'), value);
  }

  const grouped = new Map();
  for (const [key, child] of trie.children) {
    const [groupedKey, groupedValue] = renderGroupedChild(key, child);
    grouped.set(groupedKey, groupedValue);
  }
  return grouped;
}

function renderGroupedChild(key, node) {
  return [key, renderNode(node)];
}

function renderNode(node) {
  if (node.children.size === 0) {
    return node.value ?? {};
  }

  const renderedChildren = [];
  for (const [key, child] of node.children) {
    renderedChildren.push([key, renderNode(child)]);
  }

  const groupedChildren = groupChildren(renderedChildren);
  const output = {};
  if (node.value !== undefined) {
    output.label = node.value;
  }
  for (const [key, value] of groupedChildren) {
    output[key] = value;
  }
  return output;
}

function escapeValue(value) {
  return value.split('\\').join('\\\\').split('"').join('\\"').split('\r').join('\\r').split('\t').join('\\t');
}

function formatValue(value, indent) {
  if (value.includes('\n')) {
    const contentIndent = `${indent}  `;
    const lines = value.split('\n').map(line => (line ? `${contentIndent}${line}` : ''));
    return `"""\n${lines.join('\n')}\n${indent}"""`;
  }
  return `"${escapeValue(value)}"`;
}

function formatTree(value, indent = '  ') {
  const lines = [];
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string') {
      lines.push(`${indent}${key} ${formatValue(child, indent)}`);
    } else {
      lines.push(`${indent}${key}`);
      lines.push(...formatTree(child, `${indent}  `));
    }
  }
  return lines;
}

for (const { locale, filePath } of localeFiles) {
  const loaded = await loadLocalesFromFile(filePath);
  const catalogue = loaded.find(entry => entry.locale === locale) || loaded[0];
  const root = createNode();
  for (const [key, value] of Object.entries(catalogue.translations)) {
    insertDottedKey(root, key, value);
  }
  const rendered = renderNode(root);
  const source = [locale, ...formatTree(rendered)].join('\n');
  await writeFile(filePath, `${source}\n`, 'utf8');
}
