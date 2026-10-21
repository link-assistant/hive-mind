/**
 * Which matrix rows actually run (issue #3630).
 *
 * Every attempt leaves a ledger record. A pull request reuses a pass recorded
 * by any earlier commit of the same pull request for the same Formal AI
 * version; a merge to main always executes once for its own source and reuses
 * only a pass of that exact source (a repeated event is a no-op). A row that
 * did not pass is retried, at most `maxAttempts` times per source, so a
 * broken row ends in an explicit `exhausted` instead of running forever. A
 * reused record keeps the identity of the run that produced the evidence.
 */
import { E2E_MATRIX } from './e2e-hello-world.lib.mjs';
import { normalizeFormalAiVersion } from './e2e-matrix-harness.lib.mjs';

export const E2E_MAX_ATTEMPTS = 3;
/** Run attempts whose ledger names are queried; a rerun beyond this is rare. */
export const LEDGER_RUN_ATTEMPTS = 6;
export const E2E_SCOPES = Object.freeze(['pull-request', 'main', 'schedule', 'dispatch']);
/** The three clients the pull request gate runs (the issue's live acceptance). */
export const PR_GATE_ROWS = Object.freeze(E2E_MATRIX.filter(row => row.model === 'formal-ai'));

export const rowKey = ({ tool, model }) => `${tool}/${model}`;

/** Ledger records are shared within one scope key: a PR, or one main source. */
export function ledgerScopeKey({ scope, pullRequest = null, sourceSha = null, runId = null }) {
  if (scope === 'pull-request') {
    if (!pullRequest) throw new Error('A pull request scope needs the pull request number');
    return `pr${pullRequest}`;
  }
  if (scope === 'main') {
    if (!/^[0-9a-f]{12,40}$/.test(String(sourceSha))) throw new Error('A main scope needs the tested source sha');
    return `main-${String(sourceSha).slice(0, 12)}`;
  }
  return `run-${runId}`;
}

export const ledgerArtifactName = ({ scopeKey, tool, model, runAttempt }) => `e2e-ledger-${scopeKey}-${tool}-${model}-a${runAttempt}`;

/** The identity of the run that produced a piece of evidence. */
const originOf = record => record.reusedFrom || { runId: record.runId, runAttempt: record.runAttempt, sourceRepository: record.sourceRepository, sourceSha: record.sourceSha, outcome: record.outcome };

/**
 * One ledger record. `reusedFrom` is set when no task ran in this attempt and
 * the row's verdict is the recorded one.
 */
export function ledgerRecord({ tool, model, scope, scopeKey, outcome, formalAiTag, pullRequest = null, custody = {}, issueUrl = null, pullRequestUrl = null, reusedFrom = null, attempt = 1, now = new Date() }) {
  return {
    v: 1,
    tool,
    model,
    scope,
    scopeKey,
    outcome: reusedFrom ? reusedFrom.outcome : outcome,
    executed: !reusedFrom,
    attempt,
    formalAiTag: normalizeFormalAiVersion(formalAiTag),
    pullRequest,
    runId: custody.runId ?? null,
    runAttempt: custody.runAttempt ?? null,
    sourceRepository: custody.sourceRepository ?? null,
    sourceSha: custody.sourceSha ?? null,
    issueUrl,
    pullRequestUrl,
    reusedFrom: reusedFrom ? { ...reusedFrom } : null,
    recordedAt: now.toISOString(),
  };
}

/**
 * The plan for every row.
 *
 * @param {object} options
 * @param {'pull-request'|'main'|'schedule'|'dispatch'} options.scope
 * @param {object[]} [options.history] ledger records of this scope key
 * @returns {Record<string, {action: 'run'|'reuse'|'exhausted'|'skip', reason: string, attempt?: number, reusedFrom?: object}>}
 */
export function planMatrixRows({ scope, rows = E2E_MATRIX, history = [], formalAiTag, sourceSha = null, maxAttempts = E2E_MAX_ATTEMPTS, force = false }) {
  if (!E2E_SCOPES.includes(scope)) throw new Error(`Unknown E2E scope: ${scope}`);
  const tag = normalizeFormalAiVersion(formalAiTag);
  const plan = {};
  for (const row of rows) {
    const key = rowKey(row);
    if (scope === 'pull-request' && !PR_GATE_ROWS.some(gate => rowKey(gate) === key)) {
      plan[key] = { action: 'skip', reason: 'the pull request gate runs the three Formal AI clients; this row runs after the merge and on schedule' };
      continue;
    }
    const records = history.filter(record => record?.v === 1 && rowKey(record) === key && normalizeFormalAiVersion(record.formalAiTag) === tag);
    // Main reuses only its own source; a pull request reuses any of its commits.
    const sameSource = record => originOf(record).sourceSha === sourceSha;
    const passes = records.filter(record => originOf(record).outcome === 'passed' && (scope === 'pull-request' || sameSource(record)));
    const attempts = records.filter(record => record.executed && record.sourceSha === sourceSha).length;
    if (force || scope === 'schedule' || scope === 'dispatch') {
      plan[key] = { action: 'run', reason: force ? 'forced' : `${scope} runs every row`, attempt: attempts + 1 };
      continue;
    }
    if (passes.length) {
      const origin = originOf(passes.reduce((latest, record) => (String(record.recordedAt) > String(latest.recordedAt) ? record : latest)));
      plan[key] = { action: 'reuse', reason: `passed in run ${origin.runId} attempt ${origin.runAttempt} for ${origin.sourceRepository}@${origin.sourceSha}`, reusedFrom: origin };
      continue;
    }
    if (attempts >= maxAttempts) {
      plan[key] = { action: 'exhausted', reason: `${attempts} unsuccessful attempts for ${sourceSha} (limit ${maxAttempts}); push a fix, or dispatch the matrix to force a run`, attempt: attempts };
      continue;
    }
    plan[key] = { action: 'run', reason: attempts ? `retry ${attempts + 1} of ${maxAttempts}: earlier attempts did not pass` : 'no recorded pass', attempt: attempts + 1 };
  }
  return plan;
}

/**
 * Read the ledger of one scope key: every row and run attempt name is looked
 * up across runs, and each artifact found is downloaded and parsed. Expired
 * or unreadable records are reported, never guessed.
 */
export async function collectLedger({ repository, scopeKey, rows = E2E_MATRIX, api, download, log = () => {} }) {
  const history = [];
  for (const row of rows)
    for (let runAttempt = 1; runAttempt <= LEDGER_RUN_ATTEMPTS; runAttempt += 1) {
      const name = ledgerArtifactName({ scopeKey, ...row, runAttempt });
      const found = await api(`repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
      for (const artifact of found?.artifacts || []) {
        if (artifact.expired) continue;
        try {
          history.push(...[].concat(await download({ runId: artifact.workflow_run?.id, name })));
        } catch (error) {
          log(`Ledger ${name} of run ${artifact.workflow_run?.id} is unreadable: ${error.message}`);
        }
      }
    }
  return history;
}

/** A step summary of the plan. */
export function formatPlanSummary({ scope, scopeKey, plan }) {
  const lines = [`### Real E2E plan (${scope}, ledger \`${scopeKey}\`)`, '', '| Row | Action | Reason |', '|---|---|---|'];
  for (const [key, entry] of Object.entries(plan)) lines.push(`| \`${key}\` | ${entry.action} | ${String(entry.reason).replace(/\|/g, '\\|')} |`);
  return `${lines.join('\n')}\n\n`;
}
