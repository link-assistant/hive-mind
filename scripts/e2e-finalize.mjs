#!/usr/bin/env node
/**
 * Finalize one matrix row after its evidence is uploaded (issue #3630): post
 * the outcome comment, close the task issue and pull request, remove owned
 * branches, and write the row's ledger record. Runs in an `if: always()` step,
 * so success, failure and cancellation all end here; running it again is a
 * no-op.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeRow } from './e2e-row.lib.mjs';
import { ledgerRecord } from './e2e-plan.lib.mjs';
import { deriveOutcome } from './e2e-task-lifecycle.lib.mjs';

const env = process.env;
const hostLogDir = env.E2E_LOG_DIR || join(env.RUNNER_TEMP || tmpdir(), 'e2e-hello-world-logs');
const ledgerDir = env.E2E_LEDGER_DIR || join(env.RUNNER_TEMP || tmpdir(), 'e2e-ledger');
const keep = env.E2E_KEEP === 'true';
const readJson = path => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const evidence = readJson(join(hostLogDir, 'result.json'));
const owned = readJson(join(hostLogDir, 'custody.json'));
let finalization;
try {
  finalization = keep ? { outcome: null, failed: false, errors: [], retainedBranches: [], actions: ['kept for inspection (E2E_KEEP)'] } : await finalizeRow({ hostLogDir, jobStatus: env.E2E_JOB_STATUS || null, env });
} catch (error) {
  finalization = { outcome: null, failed: true, errors: [error.message], retainedBranches: [], actions: [] };
}
const outcome = finalization.outcome || deriveOutcome({ evidence, jobStatus: env.E2E_JOB_STATUS || null });
const [tool, model] = [env.E2E_TOOL || evidence?.tool, env.E2E_MODEL || evidence?.model];
if (env.E2E_SCOPE_KEY && tool && model) {
  mkdirSync(ledgerDir, { recursive: true });
  const record = ledgerRecord({ tool, model, scope: env.E2E_SCOPE, scopeKey: env.E2E_SCOPE_KEY, outcome, formalAiTag: env.E2E_FORMAL_AI_TAG, pullRequest: env.E2E_PULL_REQUEST ? Number(env.E2E_PULL_REQUEST) : null, custody: owned?.custody || { runId: env.GITHUB_RUN_ID, runAttempt: String(env.GITHUB_RUN_ATTEMPT || '1'), sourceRepository: env.GITHUB_REPOSITORY, sourceSha: env.E2E_SOURCE_SHA || env.GITHUB_SHA }, issueUrl: evidence?.issueUrl || null, pullRequestUrl: evidence?.pullRequestUrl || null, attempt: Number(env.E2E_ATTEMPT || 1) });
  writeFileSync(join(ledgerDir, 'ledger.json'), JSON.stringify(record, null, 2));
}
const lines = [`### Finalized ${tool}/${model}: \`${outcome}\``, '', ...finalization.actions.map(action => `- ${action}`), ...finalization.errors.map(error => `- ❌ ${error}`), ...finalization.retainedBranches.map(branch => `- ⚠️ retained \`${branch}\``), ''];
console.log(lines.join('\n'));
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
if (finalization.retainedBranches.length && !finalization.failed) console.log('::warning title=retained branches::A repository rule kept fixture branches; on a pull request this is reported, not failed.');
if (finalization.failed) {
  console.log(`::error title=${tool}/${model} finalization::${finalization.errors.join('; ') || 'owned branches were retained'}`);
  process.exitCode = 1;
}
