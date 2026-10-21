#!/usr/bin/env node
/**
 * Plan the real E2E matrix (issue #3630).
 *
 * `prepare` (default): resolve the scope of this run, read the ledger of that
 * scope and write the per-row plan to GITHUB_OUTPUT.
 * `row`: apply one row's entry of that plan in the row job. A reused row
 * records which run produced its evidence; an exhausted row fails with the
 * reason instead of starting a fourth task.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gh, ghApi } from './github-actions.lib.mjs';
import { collectLedger, formatPlanSummary, ledgerRecord, ledgerScopeKey, planMatrixRows, resolveScope, rowKey } from './e2e-plan.lib.mjs';

const env = process.env;
const output = text => (env.GITHUB_OUTPUT ? appendFileSync(env.GITHUB_OUTPUT, text) : process.stdout.write(text));
const summary = text => env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, text);

async function prepare() {
  const event = env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const { scope, pullRequest, sourceSha } = resolveScope({ env, event });
  const scopeKey = ledgerScopeKey({ scope, pullRequest, sourceSha, runId: env.GITHUB_RUN_ID });
  // Schedules and dispatches always run every row, so their ledger is not read.
  const history =
    scope === 'pull-request' || scope === 'main'
      ? await collectLedger({
          repository: env.GITHUB_REPOSITORY,
          scopeKey,
          api: ghApi,
          log: message => console.log(`::warning title=E2E ledger::${message}`),
          download: async ({ runId, name }) => {
            const directory = await mkdtemp(join(tmpdir(), 'hive-e2e-ledger-'));
            try {
              await gh(['run', 'download', String(runId), '--repo', env.GITHUB_REPOSITORY, '--name', name, '--dir', directory]);
              return readdirSync(directory)
                .filter(file => file.endsWith('.json'))
                .map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')));
            } finally {
              await rm(directory, { recursive: true, force: true });
            }
          },
        })
      : [];
  const plan = planMatrixRows({ scope, history, formalAiTag: env.E2E_FORMAL_AI_TAG, sourceSha, force: env.E2E_FORCE === 'true' });
  for (const [key, entry] of Object.entries(plan)) console.log(`${key}: ${entry.action} (${entry.reason})`);
  output(`plan=${JSON.stringify(plan)}\nscope=${scope}\nscope_key=${scopeKey}\nsource_sha=${sourceSha || ''}\n`);
  summary(formatPlanSummary({ scope, scopeKey, plan }));
}

function row() {
  const plan = JSON.parse(env.E2E_PLAN || '{}');
  const key = rowKey({ tool: env.E2E_TOOL, model: env.E2E_MODEL });
  const entry = plan[key] || { action: 'run', reason: 'no plan entry (direct invocation)', attempt: 1 };
  output(`action=${entry.action}\nattempt=${entry.attempt || 1}\n`);
  if (entry.action === 'reuse') {
    const ledgerDir = env.E2E_LEDGER_DIR || join(env.RUNNER_TEMP || tmpdir(), 'e2e-ledger');
    mkdirSync(ledgerDir, { recursive: true });
    const record = ledgerRecord({ tool: env.E2E_TOOL, model: env.E2E_MODEL, scope: env.E2E_SCOPE, scopeKey: env.E2E_SCOPE_KEY, outcome: entry.reusedFrom.outcome, formalAiTag: env.E2E_FORMAL_AI_TAG, pullRequest: env.E2E_PULL_REQUEST ? Number(env.E2E_PULL_REQUEST) : null, custody: { runId: env.GITHUB_RUN_ID, runAttempt: String(env.GITHUB_RUN_ATTEMPT || '1'), sourceRepository: env.GITHUB_REPOSITORY, sourceSha: env.E2E_SOURCE_SHA || null }, reusedFrom: entry.reusedFrom });
    writeFileSync(join(ledgerDir, 'ledger.json'), JSON.stringify(record, null, 2));
    console.log(`::notice title=${key} reused::${entry.reason}`);
    summary(`### ${key}: reused\n\n${entry.reason}. No task was created in this run.\n\n`);
  } else if (entry.action === 'skip') console.log(`::notice title=${key} skipped::${entry.reason}`);
  else if (entry.action === 'exhausted') {
    console.log(`::error title=${key} retries exhausted::${entry.reason}`);
    summary(`### ${key}: retries exhausted\n\n${entry.reason}\n\n`);
    process.exitCode = 1;
  } else console.log(`${key}: ${entry.reason}`);
}

if (process.argv[2] === 'row') row();
else await prepare();
