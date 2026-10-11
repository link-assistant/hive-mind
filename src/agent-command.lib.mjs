#!/usr/bin/env node

/**
 * Pure Agent command/event policy helpers.
 *
 * Keeping argv construction out of agent.lib.mjs makes it possible to test the
 * exact process shape without loading use-m or starting an Agent process.
 */

const SAFE_SHELL_WORD = /^[a-zA-Z0-9_\-./=,+@:]+$/;

/**
 * Issue #2247 (H5): Agent's per-message summary and title generators, switched off.
 *
 * `SessionSummary.summarizeMessage` (src/session/summary.ts) runs after every
 * user message and, when `config.summarizeSession` is true, makes two model
 * calls — a summary and, right below it, "generating title via API". Neither
 * uses `--model`: both resolve `userMsg.compactionModel`, whose default cascade
 * begins at `opencode/big-pickle`. In a Hive Mind task that provider is not the
 * one the run is authenticated for, so every call comes back
 * `HTTP 400 {"type":"MissingSessionID","message":"... OpenCode's free tier can
 * only be used in OpenCode"}` — 12 of them per session in the Scala
 * reproduction run, for output nobody reads.
 *
 * This is *not* context compaction, which issue #2236 deliberately keeps on:
 * compaction lives in `src/session/compaction.ts`, is driven by
 * `--compaction-model` / `--compaction-models`, and does not read
 * `config.summarizeSession` at all.
 *
 * `--generate-title` already defaults to false in agent 0.26.1, but the
 * reproduction run's CLI generated titles anyway, so it is pinned rather than
 * assumed.
 */
export const AGENT_AUXILIARY_DISABLE_ARGS = Object.freeze(['--no-summarize-session', '--no-generate-title']);

const shellQuote = value => {
  const stringValue = String(value);
  if (SAFE_SHELL_WORD.test(stringValue)) return stringValue;
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
};

/**
 * Build Agent's arguments as individual process.argv atoms.
 *
 * @param {Object} [options]
 * @param {string} options.model
 * @param {boolean} [options.verbose]
 * @param {string|null} [options.resume]
 * @param {boolean} [options.streamingInput]
 * @param {boolean} [options.auxiliaryModelCallsDisabled=true] - issue #2247 (H5);
 *   false reproduces the pre-fix argv and is only used by tests.
 */
export const buildAgentArgs = ({ model, verbose = false, resume = null, streamingInput = false, auxiliaryModelCallsDisabled = true } = {}) => {
  if (!model) throw new Error('Agent model is required');

  const args = ['--model', String(model)];
  if (auxiliaryModelCallsDisabled) args.push(...AGENT_AUXILIARY_DISABLE_ARGS);
  if (verbose) args.push('--verbose');
  if (resume) args.push('--resume', String(resume), '--no-fork');
  if (streamingInput) args.push('--input-format', 'stream-json', '--output-format', 'stream-json');
  return args;
};

/** Render argv for logs/dry-run output without changing the execution shape. */
export const formatAgentArgsForDisplay = args => (args || []).map(shellQuote).join(' ');

/**
 * Agent emits idle/disposal records after terminal errors too. Only these
 * explicit records prove that a preceding error was recovered.
 */
export const isAgentStrongCompletionEvent = data => {
  if (!data || typeof data !== 'object') return false;
  if (data.type === 'step_finish' && data.part?.reason === 'stop') return true;
  return data.type === 'result' && (data.status === 'success' || data.subtype === 'success');
};

/** Events that mean the CLI is currently waiting, used only by live input. */
export const isAgentIdleEvent = data => {
  if (!data || typeof data !== 'object') return false;
  if (['session.idle', 'session_idle', 'idle'].includes(data.type)) return true;
  if (data.type === 'log' && ['exiting loop', 'Agent exiting'].includes(data.message)) return true;
  return isAgentStrongCompletionEvent(data);
};

/**
 * Fail closed when Agent resolves a Formal AI request to any other provider.
 * The critical parser record is handled before the provider can make a request;
 * the resolved-provider record is a second, independent guard.
 */
export const detectFormalAiAgentRoutingMismatch = (record, expectedModel) => {
  if (expectedModel !== 'formalai/formal-ai' || !record || typeof record !== 'object' || record.type !== 'log') return null;

  const message = String(record.message || '');
  if (/CRITICAL: --model flag detected/i.test(message) && /default model will be used instead/i.test(message)) {
    return `Agent could not parse the requested ${expectedModel} model and announced that its default model would be used instead`;
  }

  if (message !== 'using explicit provider/model' || !record.providerID || !record.modelID) return null;
  const actualModel = `${record.providerID}/${record.modelID}`;
  return actualModel === expectedModel ? null : `Agent requested ${expectedModel} but selected ${actualModel}; stopping before another provider can be used`;
};

/**
 * Decide whether a streaming error was recovered from (issue #1276) and what to log.
 *
 * Exit code 0 with a completion event clears the streaming error, but an error
 * record found in the output still fails the run (issue #1201). The log used to
 * say "recovered ... completed successfully" right before "❌ Agent reported
 * error" for the same error (issue #2923, Formal AI run 37959364207), so the
 * recovery message is only printed when the run really is treated as a success.
 *
 * @param {{exitCode: number|null, agentCompletedSuccessfully: boolean, streamingErrorDetected: boolean, outputErrorDetected: boolean}} state
 * @returns {{clearStreamingError: boolean, message: string|null}}
 */
export const resolveStreamingErrorRecovery = ({ exitCode, agentCompletedSuccessfully, streamingErrorDetected, outputErrorDetected }) => {
  const clearStreamingError = exitCode === 0 && (agentCompletedSuccessfully || !streamingErrorDetected);
  if (!clearStreamingError || !streamingErrorDetected || !agentCompletedSuccessfully) return { clearStreamingError, message: null };
  return {
    clearStreamingError,
    message: outputErrorDetected ? 'ℹ️  Agent exited 0 after an error event; the error event in its output still fails the run' : 'ℹ️  Agent recovered from earlier error and completed successfully',
  };
};

export default {
  AGENT_AUXILIARY_DISABLE_ARGS,
  buildAgentArgs,
  detectFormalAiAgentRoutingMismatch,
  formatAgentArgsForDisplay,
  isAgentIdleEvent,
  isAgentStrongCompletionEvent,
  resolveStreamingErrorRecovery,
};
