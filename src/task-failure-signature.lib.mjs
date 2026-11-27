import { codexCodeModeHostFailure } from './codex-code-mode-failure.lib.mjs';

const solverLogPrefix = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[(?:INFO|ERROR|WARNING|WARN)\] /;
const dockerLogPrefix = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z /;
const dirtyCheckout = /^Repository has uncommitted changes after clone(?:$|:| \(.+\)$)/;
const restartLimit = /^Auto-restart limit reached after \d+ iterations? - the blocker was never resolved\.$/;
export const emptyRepositoryFailure = /^(?:Repository setup failed - empty repository|Empty repository auto-initialization failed|Empty repository detected - use --auto-init-repository to initialize)$/i;
const maxOutputTokens = 'Incomplete response returned, reason: max_output_tokens';
const stoppedToolSession = /^❌ The AI session failed and (?:`--[\w-]+`|the automation) stopped \(tool_failure(?:_after_resume)?\)\.$/;
const draftRestoreDetailPrefix = ' was left in draft by a working session (';
const draftRestoreDetailSuffix = '); restoring its pre-run state at ';
const toolFailureDetailSignatures = new Map([
  [maxOutputTokens, 'codex-max-output-tokens'],
  [codexCodeModeHostFailure, 'codex-code-mode-host'],
]);
const terminalSignatures = new Map([
  ['Auto-restart limit reached', 'auto-restart-limit'],
  ['No progress between sessions', 'no-progress'],
  ['Same CI failure repeated', 'same-ci-failure'],
  ['Authentication error', 'authentication'],
  ['Permission check failed', 'repository-permission'],
]);

function solveFailureSignature(text) {
  let signature;
  let executionError;
  let toolFailureSignature;
  let expectToolFailureDetail = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(dockerLogPrefix, '').replace(solverLogPrefix, '').trimEnd();
    if (expectToolFailureDetail && line.startsWith('   ')) toolFailureSignature = toolFailureDetailSignatures.get(line.slice(3));
    expectToolFailureDetail = false;
    if (line.startsWith('Error executing command: ') || line.startsWith('Error: ')) {
      const message = line.replace(/^Error(?: executing command)?: /, '');
      executionError = dirtyCheckout.test(message) ? 'checkout-dirty' : emptyRepositoryFailure.test(message) ? 'repository-empty' : undefined;
      continue;
    }
    if (line.startsWith('🩹 PR #') && /run end \(AI session failed \(tool_failure(?:_after_resume)?\)\)$/u.test(line)) {
      const prefix = line.indexOf(draftRestoreDetailPrefix);
      if (prefix !== -1) {
        const start = prefix + draftRestoreDetailPrefix.length;
        const end = line.indexOf(draftRestoreDetailSuffix, start);
        if (end !== -1) toolFailureSignature = toolFailureDetailSignatures.get(line.slice(start, end)) ?? toolFailureSignature;
      }
      continue;
    }
    if (!line.startsWith('❌ ')) continue;
    const verdict = line.slice('❌ '.length);
    // task wraps the child solve invocation. Its exit line adds no cause.
    if (/^Error: solve exited with code \d+$/.test(verdict)) continue;
    signature = terminalSignatures.get(verdict);
    if (restartLimit.test(verdict)) signature = 'auto-restart-limit';
    else if (emptyRepositoryFailure.test(verdict)) signature = 'repository-empty';
    else if (verdict === 'Error occurred') signature = executionError;
    else if (/^AI session failed \(tool_failure(?:_after_resume)?\)$/u.test(verdict)) signature = toolFailureSignature ?? 'tool-failure';
    else if (verdict.startsWith('CODEX execution failed with This content was flagged for possible cybersecurity risk.')) signature = 'tool-content-policy';
    else if (verdict.startsWith('CODEX execution failed with ')) signature = toolFailureDetailSignatures.get(verdict.slice('CODEX execution failed with '.length));
    executionError = undefined;
    toolFailureSignature = undefined;
    expectToolFailureDetail = stoppedToolSession.test(line);
  }
  return signature;
}

/** Classify a bounded log excerpt from a single completed attempt. */
export function classifyTaskFailure(attempt, text = '') {
  if (!(attempt.exitCode > 0)) return undefined;
  if (attempt.exitCode === 127 && /^\s*\/[\w-]+\s/.test(attempt.command || '')) return 'alias-127';
  if (/no rollout found for thread id/i.test(text)) return 'codex-no-rollout';
  if (text.includes('Result event received') && text.includes('Stream timeout') && text.includes('failed with exit code 143')) return 'stream-close-timeout';
  const memoryExhausted = attempt.oomKilled === true || attempt.memoryExhausted === true;
  if (/Codex (?:exited|command failed) with exit code 137/.test(text) && (memoryExhausted || /oom_kill=[1-9]|OOM killer has killed [1-9]|"oomKills":\s*[1-9]/.test(text))) return 'codex-oom';
  return attempt.exitCode === 1 && !memoryExhausted ? solveFailureSignature(text) : undefined;
}
