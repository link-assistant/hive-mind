#!/usr/bin/env node

/**
 * Issue #2113 end-to-end: the same race through use-m itself, before and after
 * the single-flight fix.
 *
 * Each mode runs in a child process with its own cold npm prefix, so neither
 * mode benefits from the other's install:
 *
 *   raw       — `globalThis.use = rawUse` (what Hive Mind effectively did),
 *               then 24 concurrent `use('command-stream')` calls, which is what
 *               24 modules with a top-level `await use('command-stream')`
 *               produce because Node evaluates sibling top-level-await
 *               subgraphs concurrently.
 *   guarded   — the same, through
 *               `wrapUseWithSingleFlight(wrapUseWithRetry(rawUse))`.
 *
 * Expected: `raw` fails (ENOTEMPTY from npm, or ERR_MODULE_NOT_FOUND from a
 * half-extracted tree) and `guarded` performs exactly one install and succeeds.
 *
 * Opt-in (needs network + npm):
 *   node experiments/issue-2113/reproduce-parallel-use-race.mjs [concurrency]
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const CONCURRENCY = Number(process.env.ISSUE_2113_CONCURRENCY ?? process.argv[3] ?? process.argv[2] ?? 24);
const SPECIFIER = 'command-stream';

if (process.argv[2] === '--child') {
  const mode = process.argv[3];
  const { ensureUseM, fetchUseMCodeFromCdn } = await import('../../src/use-m-bootstrap.lib.mjs');

  if (mode === 'raw') {
    // Model the pre-fix code path: the unguarded loader straight from the CDN.
    globalThis.use = (await eval(await fetchUseMCodeFromCdn())).use;
  } else {
    // ensureUseM applies wrapUseWithSingleFlight(wrapUseWithRetry(rawUse)).
    await ensureUseM();
  }

  const started = Date.now();
  const results = await Promise.allSettled(Array.from({ length: CONCURRENCY }, () => globalThis.use(SPECIFIER)));
  const failures = results.filter(result => result.status === 'rejected');
  process.stdout.write(`   ${failures.length}/${results.length} loads failed in ${Date.now() - started}ms\n`);
  for (const failure of failures.slice(0, 3)) {
    const message = String(failure.reason?.message ?? failure.reason)
      .split('\n')
      .slice(0, 4)
      .join('\n      ');
    process.stdout.write(`      ${message}\n`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

const runMode = async mode => {
  const prefix = await mkdtemp(path.join(tmpdir(), `hive-mind-issue-2113-${mode}-`));
  await mkdir(path.join(prefix, 'lib', 'node_modules'), { recursive: true });
  process.stdout.write(`## ${mode}\n`);
  const child = spawn(process.execPath, [scriptPath, '--child', mode], {
    stdio: 'inherit',
    env: { ...process.env, npm_config_prefix: prefix, ISSUE_2113_CONCURRENCY: String(CONCURRENCY), HIVE_MIND_USE_M_LOCK_DIR: path.join(prefix, 'locks') },
  });
  const [code] = await once(child, 'exit');
  process.stdout.write(`   exit code: ${code}\n\n`);
  await rm(prefix, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  return code;
};

const rawCode = await runMode('raw');
const guardedCode = await runMode('guarded');

process.stdout.write(`raw: ${rawCode === 0 ? 'succeeded (race did not trigger this run)' : 'failed as expected'}\n`);
process.stdout.write(`guarded: ${guardedCode === 0 ? 'succeeded' : 'FAILED — the fix did not hold'}\n`);
process.exit(guardedCode === 0 ? 0 : 1);
