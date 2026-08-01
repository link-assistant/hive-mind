#!/usr/bin/env node

/**
 * Standalone reproduction for link-foundation/use-m: concurrent `use()` calls
 * for the same specifier each run their own `npm install -g`, and the installs
 * corrupt each other.
 *
 * Nothing here is Hive Mind specific — it is use-m from the CDN plus a cold npm
 * prefix, so it can be pasted verbatim into an upstream issue.
 *
 * Two `use()` calls for the same specifier that overlap in time is not an exotic
 * situation: Node evaluates sibling top-level-await subgraphs concurrently, so a
 * module graph where several modules open with
 * `const { $ } = await use('command-stream')` produces exactly this.
 *
 * Opt-in (needs network + npm):
 *   node experiments/issue-2113/upstream-use-m-concurrency-repro.mjs [concurrency]
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const CONCURRENCY = Number(process.env.USE_M_CONCURRENCY ?? process.argv[3] ?? process.argv[2] ?? 8);
const SPECIFIER = process.env.USE_M_SPECIFIER ?? 'command-stream';
const USE_M_URL = process.env.USE_M_URL ?? 'https://unpkg.com/use-m@8.14.4/use.js';

if (process.argv[2] === '--child') {
  const { use } = await eval(await (await fetch(USE_M_URL)).text());

  const started = Date.now();
  const results = await Promise.allSettled(Array.from({ length: CONCURRENCY }, () => use(SPECIFIER)));
  const failures = results.filter(result => result.status === 'rejected');

  process.stdout.write(`${failures.length}/${results.length} concurrent use('${SPECIFIER}') calls failed in ${Date.now() - started}ms\n`);
  for (const failure of failures.slice(0, 2)) {
    process.stdout.write(
      `\n${String(failure.reason?.message ?? failure.reason)
        .split('\n')
        .slice(0, 6)
        .join('\n')}\n`
    );
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

// A cold prefix per run, so the reproduction does not depend on what is already
// installed globally on the machine.
const prefix = await mkdtemp(path.join(tmpdir(), 'use-m-concurrency-'));
await mkdir(path.join(prefix, 'lib', 'node_modules'), { recursive: true });

process.stdout.write(`use-m: ${USE_M_URL}\nnode: ${process.version}\nprefix: ${prefix}\n\n`);

const child = spawn(process.execPath, [scriptPath, '--child'], {
  stdio: 'inherit',
  env: { ...process.env, npm_config_prefix: prefix, USE_M_CONCURRENCY: String(CONCURRENCY), USE_M_SPECIFIER: SPECIFIER, USE_M_URL },
});
const [code] = await once(child, 'exit');

await rm(prefix, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
process.stdout.write(`\nexit code: ${code} — ${code === 0 ? 'race did not trigger this run, retry or raise the concurrency' : 'reproduced'}\n`);
process.exit(code === 0 ? 1 : 0);
