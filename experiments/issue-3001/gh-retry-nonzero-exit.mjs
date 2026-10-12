#!/usr/bin/env node
// Issue #3001 follow-up: does wrapDollarWithGhRetry retry a failing `gh` call
// made through command-stream's `$`? command-stream RESOLVES on a non-zero
// exit, so before the fix the retry loop (which only catches throws) never ran.
// A fake `gh` on PATH prints a transient 502 error, exits 1 and counts calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCommandStreamDollar } from '../../src/start-command-cli.lib.mjs';
import { wrapDollarWithGhRetry } from '../../src/github-rate-limit.lib.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-3001-'));
const counter = path.join(dir, 'count');
fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\necho x >> ${counter}\necho "HTTP 502: 502 Bad Gateway (https://api.github.com/graphql)" >&2\nexit 1\n`, { mode: 0o755 });
process.env.PATH = `${dir}:${process.env.PATH}`;

const $ = wrapDollarWithGhRetry(await getCommandStreamDollar(), { transientMaxAttempts: 3, transientDelay: 10, log: m => console.log('retry log:', m) });
try {
  const r = await $({ mirror: false })`gh api graphql`;
  console.log('resolved, code:', r.code, 'stderr:', String(r.stderr).trim());
} catch (e) {
  console.log('threw:', e.message);
}
console.log('gh invocations:', fs.readFileSync(counter, 'utf8').trim().split('\n').length);
fs.rmSync(dir, { recursive: true, force: true });
