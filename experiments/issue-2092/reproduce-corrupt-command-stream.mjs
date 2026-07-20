#!/usr/bin/env node

/**
 * Issue #2092 reproduction — a corrupt global `command-stream` install.
 *
 * Recreates the exact production failure without touching the real global
 * node_modules: a use-m alias directory whose entry file is truncated
 * mid-line, so `import()` throws a SyntaxError that use-m wraps as
 * `Failed to import module from '<...>/command-stream-v-latest/src/$.mjs'.`
 *
 * Part 1 shows the pre-fix behaviour (raw `use`): one hard failure.
 * Part 2 shows the post-fix behaviour (`wrapUseWithRetry`): the corrupt alias
 * directory is deleted and the load succeeds on the retry.
 *
 * Run: node experiments/issue-2092/reproduce-corrupt-command-stream.mjs
 */

import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { wrapUseWithRetry } from '../../src/use-with-retry.lib.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'issue-2092-'));
const aliasDir = path.join(root, 'command-stream-v-latest');
const entry = path.join(aliasDir, 'src', '$.mjs');

// A truncated file — exactly what a half-written `npm install -g` leaves behind.
const writeCorruptInstall = async () => {
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, 'export const $ = (');
  await writeFile(path.join(aliasDir, 'package.json'), JSON.stringify({ name: 'command-stream', version: '0.0.0' }));
};

// The healthy install use-m would fetch on a clean retry.
const writeHealthyInstall = async () => {
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, 'export const $ = () => "ok";');
  await writeFile(path.join(aliasDir, 'package.json'), JSON.stringify({ name: 'command-stream', version: '0.0.0' }));
};

// A stand-in for use-m: installs on demand, then imports — and wraps import
// failures in the same message shape use-m@8.14.2 produces (use.js:954).
const makeUse = () => async () => {
  try {
    await access(entry);
  } catch {
    await writeHealthyInstall();
  }
  try {
    return await import(`${pathToFileURL(entry).href}?t=${counter++}`);
  } catch (error) {
    throw new Error(`Failed to import module from '${entry}'.`, { cause: error });
  }
};
let counter = 0;

console.log('== Part 1: raw use() — the failure reported in issue #2092 ==');
await writeCorruptInstall();
try {
  await makeUse()('command-stream');
  console.log('❌ unexpected success');
} catch (error) {
  console.log(`❌ ${error.message}`);
  console.log(`   Caused by: ${error.cause?.name}: ${error.cause?.message}`);
}

console.log('\n== Part 2: wrapUseWithRetry — the fix ==');
await writeCorruptInstall();
const wrapped = wrapUseWithRetry(makeUse());
const module = await wrapped('command-stream');
console.log(`✅ recovered: $() => ${module.$()}`);

await rm(root, { recursive: true, force: true });
