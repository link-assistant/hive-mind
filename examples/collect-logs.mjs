#!/usr/bin/env node

/**
 * examples/collect-logs.mjs
 *
 * Collect every log Hive Mind produces into one directory, so an incident,
 * a security review or a bug report has a single artifact to work from.
 *
 * Hive Mind writes logs in five different places — the run log in the working
 * directory, the Telegram bot's rotated log, the console log `$` keeps for each
 * isolated session, Docker's own capture of a task container, and (with
 * `--use-router`) the router's per-task request logs inside a named volume that
 * outlives every container. Collecting only one of them is the usual reason an
 * investigation stalls.
 *
 * Usage:
 *   node examples/collect-logs.mjs --out ./hive-mind-logs
 *   node examples/collect-logs.mjs --out ./hive-mind-logs --session <uuid>
 *   node examples/collect-logs.mjs --list          # print the locations, copy nothing
 *
 * The bot state directory is deliberately NOT copied: it holds the router's
 * token-signing secret. Its path is reported so it can be inspected in place.
 *
 * @see docs/COLLECTING-LOGS.md
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { collectRouterLogs, describeSystemLogLocations, resolveSessionConsoleLogPath } from '../src/router-logs.lib.mjs';

const execFileAsync = promisify(execFile);

const argOf = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const locations = describeSystemLogLocations();

if (process.argv.includes('--list')) {
  for (const entry of locations) {
    console.log(`\n${entry.key}  (${entry.kind})`);
    console.log(`  ${entry.path}`);
    console.log(`  ${entry.description}`);
  }
  process.exit(0);
}

const outDir = path.resolve(argOf('--out') || './hive-mind-logs');
const sessionId = argOf('--session');
fs.mkdirSync(outDir, { recursive: true });

const copied = [];
const skipped = [];

/** Copy a file or directory if it exists, recording either way. */
const take = (label, source) => {
  if (!fs.existsSync(source)) {
    skipped.push(`${label}: nothing at ${source}`);
    return;
  }
  const destination = path.join(outDir, label);
  fs.cpSync(source, destination, { recursive: true });
  copied.push(`${label} ← ${source}`);
};

for (const entry of locations) {
  if (entry.kind !== 'directory') continue;
  // Never copy the state directory: it contains the router signing secret.
  if (entry.key === 'bot-state') {
    skipped.push(`bot-state: not copied on purpose (holds the router signing secret); inspect it in place at ${entry.path}`);
    continue;
  }
  if (entry.key === 'session-console' && sessionId) {
    take('session-console', resolveSessionConsoleLogPath({ sessionId }));
    continue;
  }
  take(entry.key, entry.path);
}

if (sessionId) {
  try {
    const { stdout } = await execFileAsync('docker', ['logs', sessionId], { maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(outDir, 'container.log'), stdout);
    copied.push(`container.log ← docker logs ${sessionId}`);
  } catch (error) {
    skipped.push(`container.log: ${error?.stderr?.toString().trim() || error.message}`);
  }
}

const routerDir = path.join(outDir, 'router');
fs.mkdirSync(routerDir, { recursive: true });
const router = await collectRouterLogs({ destination: routerDir, log: async message => console.log(message) });
if (router.collected) copied.push(`router/ ← ${router.via === 'container' ? 'running sidecar' : 'router data volume'}`);
else skipped.push(`router/: ${router.error}`);

const index = ['# Hive Mind log collection', '', `Collected at ${new Date().toISOString()}${sessionId ? ` for session \`${sessionId}\`` : ''}.`, '', '## Included', '', ...copied.map(line => `- ${line}`), '', '## Not included', '', ...skipped.map(line => `- ${line}`), '', '## What each location holds', '', ...locations.map(entry => `- **${entry.key}** (\`${entry.path}\`) — ${entry.description}`), ''].join('\n');
fs.writeFileSync(path.join(outDir, 'INDEX.md'), index);

console.log(`\n✅ ${copied.length} location(s) collected into ${outDir}`);
if (skipped.length > 0) console.log(`ℹ️  ${skipped.length} skipped — see ${path.join(outDir, 'INDEX.md')}`);
