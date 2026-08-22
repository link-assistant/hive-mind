#!/usr/bin/env node

/**
 * Pure Agent command/event policy helpers.
 *
 * Keeping argv construction out of agent.lib.mjs makes it possible to test the
 * exact process shape without loading use-m or starting an Agent process.
 */

const SAFE_SHELL_WORD = /^[a-zA-Z0-9_\-./=,+@:]+$/;

const shellQuote = value => {
  const stringValue = String(value);
  if (SAFE_SHELL_WORD.test(stringValue)) return stringValue;
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
};

/** Build Agent's arguments as individual process.argv atoms. */
export const buildAgentArgs = ({ model, verbose = false, resume = null, streamingInput = false } = {}) => {
  if (!model) throw new Error('Agent model is required');

  const args = ['--model', String(model)];
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

export default {
  buildAgentArgs,
  detectFormalAiAgentRoutingMismatch,
  formatAgentArgsForDisplay,
  isAgentIdleEvent,
  isAgentStrongCompletionEvent,
};
