// A terminal failure is disposable only after its log and every change are remote.
// Accept a system recovery record; quoted JSON/model messages are not receipts.
import { postTrackedComment } from './tool-comments.lib.mjs';

export const DISPOSABLE_FAILURE_MARKER = 'HIVE_TASK_DISPOSABLE_FAILURE';
const reasons = new Set(['authentication', 'model_refusal', 'auto_restart_limit']);

export function hasDisposableFailureReceipt(text) {
  return (
    String(text || '')
      .split('\n')
      // start-command captures the solver's console record as STDOUT; the
      // solver's own file captures it under RECOVERY. Strip only that envelope.
      .map(line => line.replace(/^\[[\dT:.Z+\- ]+\]\s+\[(?:STDOUT|RECOVERY)\]\s+(?=\[[\dT:.Z+\- ]+\]\s+\[RECOVERY\])/, ''))
      .some(line => /^\[[\dT:.Z+\- ]+\]\s+\[RECOVERY\]\s+HIVE_TASK_DISPOSABLE_FAILURE (authentication|model_refusal|auto_restart_limit)$/.test(line))
  );
}

export async function isFailedTaskWorkRemote({ preserved, tempDir, branchName, $ }) {
  if (!preserved?.complete || preserved.error || (preserved.committed && !preserved.pushed)) return false;
  try {
    // A pushed recovery commit includes HEAD as its parent. Otherwise HEAD must
    // already be the remote PR branch tip, even when the working tree is clean.
    if (!preserved.pushed) {
      if (!tempDir || !branchName) return false;
      const git = $({ cwd: tempDir, mirror: false, noThrow: true });
      const head = await git`git rev-parse HEAD`;
      const remote = await git`git ls-remote origin ${`refs/heads/${branchName}`}`;
      if (head.code !== 0 || remote.code !== 0 || remote.stdout?.toString().split(/\s/)[0] !== head.stdout?.toString().trim()) return false;
    }
    return true;
  } catch {
    return false; // Unknown preservation state always retains the container.
  }
}

export async function recordDisposableFailure(options) {
  const { reason, logsUploaded, argv, log } = options;
  const workRemote = await isFailedTaskWorkRemote(options);
  if (argv && !workRemote) {
    argv.autoCleanup = false;
    argv.autoCleanupSource = 'incomplete-recovery';
  }
  if (!reasons.has(reason) || !logsUploaded || !workRemote) return false;
  await log(`[${new Date().toISOString()}] [RECOVERY] ${DISPOSABLE_FAILURE_MARKER} ${reason}`, { level: 'recovery' });
  return true;
}

export async function reportModelRefusal({ refusal, logsUploaded, $, owner, repo, targetNumber, log }) {
  if (!refusal?.isModelRefusal || logsUploaded || !targetNumber) return false;
  const result = await postTrackedComment({ $, owner, repo, targetNumber, body: `## Model refused the task\n\n${refusal.guidance}` });
  if (!result.ok) await log('Could not post model refusal guidance; see the local log.', { level: 'warning' });
  return result.ok;
}
