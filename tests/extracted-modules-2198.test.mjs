/**
 * @hive-mind-test-suite default
 *
 * Issue #2198: the "Checks and release" run ended with two CI warnings —
 *
 *   ::warning file=src/telegram-bot.mjs::File has 1377 lines (approaching limit of 1500)
 *   ::warning file=src/solve.repository.lib.mjs::File has 1373 lines (approaching limit of 1500)
 *
 * — the early-warning threshold scripts/check-file-line-limits.sh emits above
 * 1350 lines, introduced by issue #1593 to keep concurrent merges from
 * conflicting. Both files were reduced by extraction, following the precedent
 * of issue #2175 (tests/hive-extracted-modules-2175.test.mjs).
 *
 * The first block is the regression test for the warnings themselves: it fails
 * if any tracked file drifts back over the threshold. The rest pins the
 * behaviour of the extracted modules, which is now reachable from a test
 * because it no longer closes over its former module's private bindings.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyCloneError, cleanPartialClone } from '../src/solve.clone-errors.lib.mjs';
import { validateCommandOverrides } from '../src/telegram-overrides-validation.lib.mjs';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// --- 1. No tracked file is back above the warning threshold ----------------

{
  // Kept in sync with WARN_THRESHOLD in scripts/check-file-line-limits.sh, and
  // read from it rather than hard-coded so the two cannot drift apart.
  const checkScript = readFileSync(join(repoRoot, 'scripts', 'check-file-line-limits.sh'), 'utf8');
  const threshold = Number(checkScript.match(/^WARN_THRESHOLD=(\d+)/m)?.[1]);
  assert.ok(Number.isInteger(threshold), 'WARN_THRESHOLD is readable from scripts/check-file-line-limits.sh');

  const tracked = spawnSync('git', ['ls-files', '-z', '--', 'src/*.mjs', '.github/workflows/*.yml'], { cwd: repoRoot, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  assert.ok(tracked.length > 0, 'git listed the files the check script covers');

  const over = tracked.map(file => [file, readFileSync(join(repoRoot, file), 'utf8').split('\n').length - 1]).filter(([, lines]) => lines > threshold);

  assert.deepEqual(over, [], `no file exceeds the ${threshold}-line warning threshold (see scripts/check-file-line-limits.sh)`);
}

// --- 2. classifyCloneError still classifies ---------------------------------

{
  // Issue #2192: the anonymous-download wording overlaps PERMISSION,
  // NOT_FOUND and RATE_LIMIT, so its precedence is the interesting part.
  assert.equal(classifyCloneError('You have exceeded a secondary rate limit').type, 'RATE_LIMIT');
  assert.equal(classifyCloneError('fatal: write error: No space left on device').type, 'ENOSPC');
  assert.equal(classifyCloneError('fatal: write error: No space left on device').retryable, false);
  // Issue #1957: an interrupted transfer is retryable.
  assert.equal(classifyCloneError('fetch-pack: unexpected disconnect while reading sideband packet').retryable, true);
  assert.equal(classifyCloneError('remote: error: 503 service unavailable').type, 'TRANSIENT');
  assert.equal(classifyCloneError('fatal: Authentication failed').retryable, false);
  assert.equal(classifyCloneError('something nobody has seen before').type, 'UNKNOWN');
  assert.equal(classifyCloneError('something nobody has seen before').retryable, true);
}

// --- 3. cleanPartialClone empties in place, and tolerates a missing dir -----

{
  const fs = await import('node:fs/promises');
  const os = await import('node:os');

  const dir = await fs.mkdtemp(join(os.tmpdir(), 'hive-mind-2198-clone-'));
  await fs.mkdir(join(dir, 'nested', 'deeper'), { recursive: true });
  await fs.writeFile(join(dir, 'nested', 'file.txt'), 'x');

  await cleanPartialClone(dir);

  assert.deepEqual(await fs.readdir(dir), [], 'the directory is emptied');
  // Emptied, not removed: setupTempDirectory may have created it as the
  // configured working directory.
  assert.ok((await fs.stat(dir)).isDirectory(), 'the directory itself survives');

  await fs.rm(dir, { recursive: true, force: true });
  await cleanPartialClone(dir); // must not throw on ENOENT
}

// --- 4. validateCommandOverrides accepts and rejects the same as before -----

{
  const { getLinoYargsFactory } = await import('../src/cli-arguments.lib.mjs');
  const { createYargsConfig: createSolveYargsConfig } = await import('../src/solve.config.lib.mjs');
  const yargs = getLinoYargsFactory();
  const dummyUrl = 'https://github.com/test/test/issues/1';

  const ok = await validateCommandOverrides({
    overrides: ['--auto-continue', '--attach-logs', '--verbose'],
    createYargsConfig: createSolveYargsConfig,
    yargs,
    dummyUrl,
  });
  assert.deepEqual(ok, { ok: true }, 'valid solve overrides pass');

  // Issue #1209: an unknown flag is caught at startup, with a suggestion.
  const unknown = await validateCommandOverrides({
    overrides: ['--getkeep-file'],
    createYargsConfig: createSolveYargsConfig,
    yargs,
    dummyUrl,
  });
  assert.equal(unknown.ok, false, 'an unknown flag is rejected');
  assert.match(unknown.message, /getkeep-file/, 'the offending flag is named in the message');

  // Issue #1534: a per-command isolation backend is validated, not passed through.
  const badIsolation = await validateCommandOverrides({
    overrides: ['--isolation', 'nonsense'],
    createYargsConfig: createSolveYargsConfig,
    yargs,
    dummyUrl,
  });
  assert.equal(badIsolation.ok, false, 'an invalid --isolation value is rejected');
  assert.match(badIsolation.message, /screen, tmux, or docker/);

  // stderr suppression must be undone even when parsing throws, and nothing
  // yargs prints may escape while it is in effect.
  const probe = [];
  const callerHook = chunk => {
    probe.push(String(chunk));
    return true;
  };
  const realWrite = process.stderr.write;
  process.stderr.write = callerHook;
  try {
    await validateCommandOverrides({ overrides: ['--nope'], createYargsConfig: createSolveYargsConfig, yargs, dummyUrl });
    assert.equal(process.stderr.write, callerHook, 'the caller stderr hook is restored after a rejected parse');
  } finally {
    process.stderr.write = realWrite;
  }
  assert.deepEqual(probe, [], 'yargs diagnostics never reach the caller stderr');
}

console.log('PASS issue #2198 extracted modules');
