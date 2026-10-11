#!/usr/bin/env node
/**
 * Regression coverage for issue #2923: CodeQL scanned throwaway scripts in
 * experiments/ and third-party copies in docs/, so 55 of the 120 open alerts on
 * main were in code this project never ships or runs, which buries the real
 * ones. The config must exclude those paths and must keep every shipped or
 * CI-executed path in scope.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2923
 * @see https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/211
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const listUnder = (yaml, key) => {
  const block = yaml.split('\n');
  const start = block.findIndex(line => line.trim() === `${key}:`);
  if (start === -1) return [];
  const items = [];
  for (const line of block.slice(start + 1)) {
    const match = line.match(/^\s+-\s+(.+?)\s*$/);
    if (!match) break;
    items.push(match[1].replace(/^['"]|['"]$/g, ''));
  }
  return items;
};

test('non-shipped paths are excluded from CodeQL', async () => {
  const ignored = listUnder(await read('.github/codeql/codeql-config.yml'), 'paths-ignore');
  for (const path of ['dev/log', 'experiments', 'examples', 'docs']) assert.ok(ignored.includes(path), `${path} must be in paths-ignore: ${ignored}`);
});

test('shipped and CI-executed paths stay in scope', async () => {
  const yaml = await read('.github/codeql/codeql-config.yml');
  assert.deepEqual(listUnder(yaml, 'paths'), [], 'a `paths` allow-list would silently drop new top-level code');
  const ignored = listUnder(yaml, 'paths-ignore');
  for (const path of ['src', 'scripts', 'tests', '.github', 'eslint-rules']) {
    assert.equal(
      ignored.some(entry => path === entry || path.startsWith(`${entry}/`) || entry === '**'),
      false,
      `${path} must stay scanned`
    );
  }
});

test('every CodeQL init step uses the config file', async () => {
  const workflow = await read('.github/workflows/security.yml');
  const inits = workflow.match(/github\/codeql-action\/init@[^\n]+(?:\n\s+(?!-\s)[^\n]+)*/g) || [];
  assert.ok(inits.length > 0, 'security.yml must initialise CodeQL');
  for (const init of inits) assert.match(init, /config-file:\s*\.\/\.github\/codeql\/codeql-config\.yml/);
});
