#!/usr/bin/env node
/**
 * Issue #4149, F1: how a cut-off GitHub reply is handled by execGhWithRetry.
 *
 * GitHub sometimes answers with an HTTP error and an empty body; gh then
 * prints only `unexpected end of JSON input` (cli/cli#10579), which failed
 * report-checks in runs 45618594320 and 45629684702. A fake `gh` on PATH
 * fails like that FAIL_TIMES times and then succeeds; a read retries through
 * it, a write is run once (retrying a write could duplicate it, issue #2571).
 *
 * Usage: node experiments/issue-4149/truncated-reply-retry.mjs [FAIL_TIMES=2]
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execGhWithRetry } from '../../src/github-rate-limit.lib.mjs';

const failTimes = Number(process.argv[2] || 2);
const directory = mkdtempSync(join(tmpdir(), 'gh-4149-'));
const counter = join(directory, 'calls');
writeFileSync(join(directory, 'gh'), `#!/bin/sh\nprintf x >> "${counter}"\nif [ "$(wc -c < "${counter}")" -le ${failTimes} ]; then echo 'unexpected end of JSON input' >&2; exit 1; fi\necho '{"state":"OPEN"}'\n`);
chmodSync(join(directory, 'gh'), 0o755);
const execOptions = { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } };

for (const command of ['gh pr view 1 --json state', 'gh pr comment 1 --body x']) {
  rmSync(counter, { force: true });
  let outcome;
  try {
    const result = await execGhWithRetry(command, { transientDelay: 0, transientMaxAttempts: 5, execOptions, log: () => {} });
    outcome = `succeeded: ${String(result.stdout ?? result).trim()}`;
  } catch (error) {
    outcome = `failed: ${String(error.stderr || error.message).trim()}`;
  }
  console.log(`${command.padEnd(28)} attempts=${readFileSync(counter, 'utf8').length} ${outcome}`);
}
rmSync(directory, { recursive: true, force: true });
