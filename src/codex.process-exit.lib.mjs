/** Process-level diagnostics when Codex cannot emit a protocol error. */
import { constants } from 'node:os';

export function normalizeCodexExit({ code, signal = null }) {
  const signalNumber = constants.signals[signal];
  const exitCode = signalNumber ? 128 + signalNumber : Number.isInteger(code) ? code : 1;
  const inferredSignal = Object.entries(constants.signals).find(([, number]) => exitCode === 128 + number)?.[0];
  return { exitCode, signal: signal || inferredSignal || null };
}

/** Only plain CLI/shell errors, never JSON or timestamped tool telemetry. */
export function findCodexStderrError(output, previous = null) {
  for (const line of output.split('\n')) {
    const text = line.trim();
    if (/^(?:error:|fatal:|(?:\/\S*\/)?(?:ba)?sh:\s)/i.test(text)) previous = text.slice(0, 1024);
  }
  return previous;
}

const gib = bytes => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const finiteLimit = snapshot => Number.isFinite(snapshot?.limitBytes) && snapshot.limitBytes > 0;

// Issue #2838: the guidance is shared by every tool now; the Codex name stays for callers.
export { buildMemoryBudgetPrompt as buildCodexMemoryBudgetPrompt } from './memory-budget.lib.mjs';

export function buildCodexProcessFailure({ exitCode, signal = null, stderrError = null, before = null, after = null }) {
  const comparable = before?.path && after && before.version === after.version && before.path === after.path && Number.isFinite(before.oomKills) && Number.isFinite(after.oomKills);
  const oomKillDelta = comparable ? Math.max(0, after.oomKills - before.oomKills) : null;
  let message = `Codex exited with exit code ${exitCode}${signal ? ` (${signal})` : ''}.`;
  if (signal === 'SIGKILL') {
    if (oomKillDelta > 0) {
      message += ` ${oomKillDelta} OOM kills were recorded in the cgroup during this attempt${finiteLimit(after) ? ` (memory limit ${gib(after.limitBytes)})` : ''}; memory exhaustion likely contributed. Reduce build/test memory or use a larger container. The counters do not identify the killed process.`;
    } else {
      message += ' The kill cause is unknown; no fresh cgroup OOM evidence is available. Check container/kernel logs and reduce build/test memory before retrying.';
    }
  } else if (signal === 'SIGINT') {
    message += ' The process was interrupted (CTRL+C).';
  } else if (stderrError) {
    message += ` ${stderrError}`;
  }
  return { hasError: true, message, exitCode, signal, oomKillDelta, cgroupMemory: { before, after }, events: [{ type: 'process_exit', message }], ignoredEvents: [], counts: { item: 0, turn: 0, stream: 0 } };
}
