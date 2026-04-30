#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const CLI_ARGUMENT_SOURCES = ['src/hive.mjs', 'src/solve.config.lib.mjs', 'src/task.config.lib.mjs', 'src/review.mjs', 'src/configure-claude.lib.mjs', 'src/start-screen.mjs', 'src/hive-screens.lib.mjs', 'src/telegram-bot.mjs', 'src/memory-check.mjs', 'src/reviewers-hive.mjs', 'do.mjs'];
const DISALLOWED_DIRECT_YARGS_PATTERNS = ["use('yargs", 'use("yargs', 'resolveYargsFactory'];

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

await test('package depends on lino-arguments', () => {
  assert.equal(packageJson.dependencies?.['lino-arguments'], '^0.3.0');
});

await test('CLI argument parsers route through lino-arguments adapter', async () => {
  const missing = [];
  const directYargs = [];
  for (const sourcePath of CLI_ARGUMENT_SOURCES) {
    const source = await readFile(new URL(`../${sourcePath}`, import.meta.url), 'utf8');
    if (!source.includes('cli-arguments.lib.mjs') && !source.includes('lino-arguments')) {
      missing.push(sourcePath);
    }
    if (DISALLOWED_DIRECT_YARGS_PATTERNS.some(pattern => source.includes(pattern))) {
      directYargs.push(sourcePath);
    }
  }

  assert.deepEqual(missing, []);
  assert.deepEqual(directYargs, []);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
