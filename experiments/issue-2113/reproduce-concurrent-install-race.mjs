#!/usr/bin/env node

/**
 * Issue #2113 root cause: concurrent `npm install -g` of the *same* use-m alias
 * destroys the package tree.
 *
 * use-m runs one `npm install -g <alias>@npm:<pkg>@<version>` per `use()` call
 * and has no in-flight deduplication, while Hive Mind has 36 modules under
 * `src/` whose body starts with a top-level `await use('command-stream')`. Node
 * evaluates sibling top-level-await subgraphs concurrently, so a cold container
 * launches dozens of simultaneous installs of one directory.
 *
 * This experiment reproduces both symptoms from the logs attached to the issue,
 * with npm only — no use-m, no Hive Mind:
 *
 *   * `npm error ENOTEMPTY: directory not empty, rmdir
 *     '<...>/command-stream-v-latest/examples'`
 *   * an alias directory that is missing or half-extracted afterwards, which is
 *     what later surfaces as `ERR_MODULE_NOT_FOUND` for an internal file.
 *
 * It also runs the control: the same number of concurrent installs of
 * *different* packages into the same global root, which succeeds. That is what
 * narrows the fix to a per-alias lock rather than a global install lock.
 *
 * Opt-in (needs network + npm):
 *   node experiments/issue-2113/reproduce-concurrent-install-race.mjs [concurrency]
 */

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
// 24 mirrors the real fan-out: 36 modules import command-stream at top level,
// and the observed damage starts well below that. At 8 the race often does not
// trigger at all (npm finishes each install before the next one reaches its
// cleanup step), which is why the failure looked "random" in production.
const CONCURRENCY = Number(process.argv[2] ?? 24);
const PACKAGE = 'command-stream';
const CONTROL_PACKAGES = ['getenv', 'links-notation', '@dotenvx/dotenvx', 'zx', 'yargs'];

const aliasFor = (name, version = 'latest') => `${name.replace('@', '').replace('/', '-')}-v-${version}`;

const installOnce = (prefix, name) =>
  execAsync(`npm install -g ${aliasFor(name)}@npm:${name}@latest`, {
    env: { ...process.env, npm_config_prefix: prefix },
  })
    .then(() => ({ name, ok: true }))
    .catch(error => ({ name, ok: false, stderr: (error.stderr || error.message || '').trim() }));

const summarise = results => {
  for (const result of results) {
    if (result.ok) continue;
    const head = result.stderr.split('\n').slice(0, 5).join('\n      ');
    process.stdout.write(`      ${head}\n`);
  }
};

const withPrefix = async run => {
  const prefix = await mkdtemp(path.join(tmpdir(), 'hive-mind-issue-2113-npm-'));
  try {
    await mkdir(path.join(prefix, 'lib', 'node_modules'), { recursive: true });
    return await run(prefix);
  } finally {
    await rm(prefix, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

process.stdout.write(`## same alias — ${CONCURRENCY} concurrent installs of ${PACKAGE}\n`);
await withPrefix(async prefix => {
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => installOnce(prefix, PACKAGE)));
  const failed = results.filter(result => !result.ok);
  process.stdout.write(`   ${failed.length}/${results.length} installs failed in ${Date.now() - started}ms\n`);
  summarise(failed);

  const aliasDirectory = path.join(prefix, 'lib', 'node_modules', aliasFor(PACKAGE));
  if (!existsSync(aliasDirectory)) {
    process.stdout.write('   alias directory does not exist after the race — every later import fails\n');
    return;
  }
  const entries = await readdir(aliasDirectory);
  process.stdout.write(`   alias directory survived with ${entries.length} top-level entries\n`);
  try {
    await import(path.join(aliasDirectory, 'src', '$.mjs'));
    process.stdout.write('   importing the entry point still works\n');
  } catch (error) {
    process.stdout.write(`   importing the entry point failed: ${error.code} ${error.message.split('\n')[0]}\n`);
  }
});

process.stdout.write(`\n## control — ${CONTROL_PACKAGES.length} concurrent installs of different packages\n`);
await withPrefix(async prefix => {
  const started = Date.now();
  const results = await Promise.all(CONTROL_PACKAGES.map(name => installOnce(prefix, name)));
  const failed = results.filter(result => !result.ok);
  process.stdout.write(`   ${failed.length}/${results.length} installs failed in ${Date.now() - started}ms\n`);
  summarise(failed);
  const present = CONTROL_PACKAGES.filter(name =>
    existsSync(path.join(prefix, 'lib', 'node_modules', aliasFor(name), 'package.json'))
  );
  process.stdout.write(`   ${present.length}/${CONTROL_PACKAGES.length} aliases installed cleanly\n`);
});
