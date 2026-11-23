import { parseArgs } from 'node:util';
import { withStateLock } from '../../state-lock.lib.mjs';
import { previewTaskRecordRepair } from '../index.mjs';
import { findRepairCandidates, inspectRepairContainer, repairPlan, repairSelection, startCommandRequirement, startLibraries } from './lib/record-repair.mjs';

const usage = `Usage: hive-manager tasks repair-records [--apply] [UUID...]
Preview adoption of running, attributed Docker resumes missing their task record update.
Requires ${startCommandRequirement}. For records already marked executing, use tasks resume-all.
`;

async function repair() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, apply: { type: 'boolean' } } });
  if (values.help) return process.stdout.write(usage);
  if (!values.apply) {
    const preview = await previewTaskRecordRepair({ uuids: positionals });
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return;
  }

  const selected = repairSelection(positionals);
  const start = await startLibraries();
  const store = new start.ExecutionStore({ appFolder: process.env.START_APP_FOLDER });
  const perform = async () => {
    const candidates = await findRepairCandidates(store.getAll(), selected, start);
    const outcomes = [];
    for (const [uuid, matches] of candidates) {
      if (matches.length > 1) {
        outcomes.push({ uuid, state: 'ambiguous' });
        continue;
      }
      const { id, name } = matches[0];
      const container = await inspectRepairContainer(id);
      const current = store.get(uuid);
      const plan = current && repairPlan(current, container, start);
      if (!plan) {
        outcomes.push({ uuid, container: name, state: 'changed' });
        continue;
      }
      const record = new start.ExecutionRecord({ ...current, options: { ...current.options } });
      const attempt = start.createAttempt(record, plan);
      attempt.startedAt = new Date(container.State.StartedAt).toISOString();
      attempt.launchAcceptedAt = attempt.startedAt;
      const updated = start.applyResumeToRecord(record, plan, id, attempt);
      store.reserveLaunch(updated, current);
      const attached = start.startDetachedDockerCompletionWatcher(name, start.getDockerContainerCleanupPolicy(updated.options), updated.logPath, uuid, { since: attempt.startedAt, attemptNumber: attempt.number, recoverOnKill: false });
      if (attached) start.patchAttempt(store, updated, { watcherAttachedAt: new Date().toISOString() });
      outcomes.push({ uuid, container: name, state: attached ? 'repaired' : 'watcher-unconfirmed' });
    }
    process.stdout.write(`${JSON.stringify({ mode: 'apply', outcomes }, null, 2)}\n`);
    if (outcomes.some(item => item.state === 'watcher-unconfirmed')) throw new Error('A repaired record has no confirmed watcher. Run tasks resume-all to reconcile it.');
  };
  await withStateLock('hive-manager-task-repair-records', perform, { timeoutMs: 5000, staleMs: 60 * 60 * 1000 });
}

try {
  await repair();
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
