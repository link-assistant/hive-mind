#!/usr/bin/env node
/**
 * Finalize one matrix row after its evidence is uploaded (issue #3630): post
 * the outcome comment, close the task issue and pull request, remove owned
 * branches, and write the row's ledger record. Runs in an `if: always()` step,
 * so success, failure and cancellation all end here; running it again is a
 * no-op.
 */
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeAndRecord } from './e2e-row.lib.mjs';

const env = process.env;
const { finalization, lines, tool, model } = await finalizeAndRecord({
  hostLogDir: env.E2E_LOG_DIR || join(env.RUNNER_TEMP || tmpdir(), 'e2e-hello-world-logs'),
  ledgerDir: env.E2E_LEDGER_DIR || join(env.RUNNER_TEMP || tmpdir(), 'e2e-ledger'),
  env,
});
console.log(lines.join('\n'));
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
if (finalization.retainedBranches.length && !finalization.failed) console.log('::warning title=retained branches::A repository rule kept fixture branches; on a pull request this is reported, not failed.');
if (finalization.failed) {
  console.log(`::error title=${tool}/${model} finalization::${finalization.errors.join('; ') || 'owned branches were retained'}`);
  process.exitCode = 1;
}
