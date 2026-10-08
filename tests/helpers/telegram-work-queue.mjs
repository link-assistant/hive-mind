/** @hive-mind-test-skip */
import { SolveQueue } from '../../src/telegram-solve-queue.lib.mjs';

/** Deterministic admission checks without host metrics, CLI probes or polling. */
export function createTestWorkQueue() {
  const emptyProcesses = async () => ({ count: 0, byTool: {} });
  const queue = new SolveQueue({ autoStart: false, getRunningProcesses: emptyProcesses, getRunningIsolatedSessions: emptyProcesses });
  queue.checkSystemResources = async () => ({ ok: true, reasons: [] });
  queue.checkApiLimits = async () => ({ ok: true, reasons: [] });
  return queue;
}
