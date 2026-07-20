#!/usr/bin/env node

/**
 * Issue #2092 — end-to-end reproduction against the REAL use-m loader.
 *
 * Unlike reproduce-corrupt-command-stream.mjs (which fakes the loader), this
 * script truncates the actual global `command-stream-v-latest` install, then:
 *
 *   Part 1 — raw `use()` reproduces the production error verbatim.
 *   Part 2 — `wrapUseWithRetry(use)` repairs the install and loads the module.
 *
 * It restores a healthy install before exiting (use-m reinstalls it anyway).
 *
 * ⚠️  This touches the global node_modules directory. Run it in a container or
 * a disposable environment.
 *
 * Run: node experiments/issue-2092/reproduce-real-use-m.mjs
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { wrapUseWithRetry } from '../../src/use-with-retry.lib.mjs';

const execFileAsync = promisify(execFile);

const bootstrapUse = async () => (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;

const { stdout: globalRoot } = await execFileAsync('npm', ['root', '-g']);
const entry = path.join(globalRoot.trim(), 'command-stream-v-latest', 'src', '$.mjs');

// Ensure a healthy install exists first — through the retry wrapper, so a tree
// left corrupt by an interrupted earlier run is repaired instead of fatal.
globalThis.use = await bootstrapUse();
await wrapUseWithRetry(globalThis.use)('command-stream');

const corrupt = () => writeFile(entry, 'export const $ = ('); // truncated, as an interrupted npm install leaves it

console.log('== Part 1: raw use() — the production failure ==');
await corrupt();
// Must run in a *fresh* process: this process already imported command-stream
// successfully above, and Node's ESM cache would serve that copy regardless of
// what is on disk. (The same cache is what makes the repair non-trivial — see
// Part 2 and docs/case-studies/issue-2092/analysis.md.)
const child = await execFileAsync(process.execPath, [
  '-e',
  `globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
   try { await globalThis.use('command-stream'); console.log('❌ unexpected success'); }
   catch (error) { console.log('❌ ' + error.message); console.log('   Caused by: ' + error.cause?.name + ': ' + error.cause?.message); }`,
]).catch(error => ({ stdout: error.stdout, stderr: error.stderr }));
process.stdout.write(child.stdout);

console.log('\n== Part 2: wrapUseWithRetry — the fix ==');
await corrupt();
process.env.HIVE_MIND_USE_M_DEBUG = '1';
const use = wrapUseWithRetry(await bootstrapUse());
const loaded = await use('command-stream');
console.log(`✅ recovered: typeof $ = ${typeof loaded.$}`);
