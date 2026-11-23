import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { applyIncidentBatch, planIncidentBatch } from './lib/incident-batch.mjs';
import { readBoundedFile } from '../lib/files.mjs';
import { listTrackedTasks } from './report.mjs';

const usage = `Usage: hive-manager tasks report-batch plan --selection FILE --output NEW_FILE [--records FILE] [--policy FILE [--legacy-ledger FILE]]
       hive-manager tasks report-batch apply --plan FILE --approve SHA256 [--legacy-ledger FILE]
Save a private incident plan for exact failed attempts or a fixed time window. Supply a policy to reconcile against an approved repository.
Review the saved report bodies and actions before applying. Reuse the plan and digest to resume publication.
`;

async function readJson(path, limit, label) {
  const bytes = await readBoundedFile(path, limit, label);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`Invalid JSON for ${label}.`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' }, selection: { type: 'string' }, output: { type: 'string' }, records: { type: 'string' }, policy: { type: 'string' }, 'legacy-ledger': { type: 'string' }, plan: { type: 'string' }, approve: { type: 'string' } },
  });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const [action] = positionals;
  if (positionals.length !== 1 || !['plan', 'apply'].includes(action)) throw new Error('Choose plan or apply. See tasks report-batch --help.');
  const ledgerPath = values['legacy-ledger'];
  if (action === 'plan') {
    if (!values.selection || !values.output || values.plan !== undefined || values.approve !== undefined) throw new Error('Planning requires --selection and --output.');
    if (ledgerPath !== undefined && values.policy === undefined) throw new Error('Ledger reconciliation requires --policy.');
    const selection = await readJson(values.selection, 128 * 1024, 'selection');
    const policy = values.policy === undefined ? undefined : await readJson(values.policy, 128 * 1024, 'publication policy');
    const legacyLedger = ledgerPath === undefined ? undefined : await readJson(ledgerPath, 8 * 1024 * 1024, 'legacy ledger');
    const snapshot = values.records === undefined ? await listTrackedTasks() : await readJson(values.records, 32 * 1024 * 1024, 'execution records');
    const plan = await planIncidentBatch(Array.isArray(snapshot) ? snapshot : snapshot?.executions, { selection, policy, legacyLedger });
    await writeFile(values.output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ output: values.output, entries: plan.entries.length, digest: plan.digest })}\n`);
    return;
  }
  if (!values.plan || !values.approve || [values.selection, values.output, values.records, values.policy].some(value => value !== undefined)) throw new Error('Apply requires --plan and --approve.');
  const plan = await readJson(values.plan, 2 * 1024 * 1024, 'saved incident plan');
  const legacyLedger = ledgerPath === undefined ? undefined : await readJson(ledgerPath, 8 * 1024 * 1024, 'legacy ledger');
  const result = await applyIncidentBatch(plan, { approve: values.approve, legacyLedger });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.outcomes.some(({ state }) => state === 'blocked')) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
});
