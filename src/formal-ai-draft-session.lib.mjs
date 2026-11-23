import { writeFile } from 'node:fs/promises';

export const DRAFT_SESSION_SCHEMA = 'hive-mind/formal-ai-draft-session/v1';
export const draftSessionReceiptPath = logFile => `${logFile}.outcome.json`;

/** Solve measures changes against the working session baseline before it publishes diagnostics. */
export async function writeDraftSessionReceipt(logFile, { measured, noChanges, terminalState, evidence }) {
  await writeFile(draftSessionReceiptPath(logFile), JSON.stringify({ schema: DRAFT_SESSION_SCHEMA, measured, noChanges, terminalState, evidence }), { mode: 0o644 });
}

export function parseDraftSessionReceipt(text) {
  try {
    const receipt = JSON.parse(text);
    if (receipt?.schema !== DRAFT_SESSION_SCHEMA || typeof receipt.measured !== 'boolean' || typeof receipt.noChanges !== 'boolean') return null;
    if (receipt.terminalState !== null && !/^[a-z][a-z_]{1,60}$/u.test(receipt.terminalState ?? '')) return null;
    return receipt;
  } catch {
    return null;
  }
}
