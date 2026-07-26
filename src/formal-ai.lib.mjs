#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { FORMAL_AI_MODEL_ALIAS, isFormalAiModel } from './models/index.mjs';

const execFileAsync = promisify(execFile);

export const FORMAL_AI_SUPPORTED_TOOLS = Object.freeze(['claude', 'agent', 'opencode', 'codex', 'qwen', 'gemini']);
export const DEFAULT_FORMAL_AI_PATH = 'formal-ai';

const SAFE_SHELL_WORD = /^[a-zA-Z0-9_\-./=,+@:]+$/;

const shellQuote = value => {
  const stringValue = String(value);
  if (SAFE_SHELL_WORD.test(stringValue)) return stringValue;
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
};

const normalizeExternalBaseUrl = value => {
  if (!value) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`HIVE_MIND_FORMAL_AI_BASE_URL must be a valid HTTP(S) URL, received "${value}"`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('HIVE_MIND_FORMAL_AI_BASE_URL must be an HTTP(S) origin without credentials, a path, a query, or a fragment');
  }

  return parsed.origin;
};

/**
 * Resolve the executable and leading arguments for one Hive tool invocation.
 * Formal AI owns the temporary client configuration and forwards all remaining
 * arguments to the selected agentic CLI unchanged.
 */
export const resolveFormalAiToolInvocation = ({ tool, model, toolPath, env = process.env }) => {
  if (!isFormalAiModel(model)) {
    return {
      command: toolPath,
      args: [],
      displayCommand: shellQuote(toolPath),
      formalAi: false,
      baseUrl: null,
    };
  }

  if (!FORMAL_AI_SUPPORTED_TOOLS.includes(tool)) {
    throw new Error(`Formal AI dispatch does not support Hive tool "${tool}"`);
  }

  const command = env.HIVE_MIND_FORMAL_AI_PATH?.trim() || DEFAULT_FORMAL_AI_PATH;
  const baseUrl = normalizeExternalBaseUrl(env.HIVE_MIND_FORMAL_AI_BASE_URL);
  const args = ['with'];

  if (baseUrl) {
    args.push('--no-start-server', '--base-url', baseUrl);
  }
  args.push(tool);

  return {
    command,
    args,
    displayCommand: [command, ...args].map(shellQuote).join(' '),
    formalAi: true,
    baseUrl,
  };
};

/**
 * Check both the wrapper and the selected native CLI without starting a model
 * server or spending a model request.
 */
export const validateFormalAiToolConnection = async (tool, { env = process.env, run = execFileAsync, timeoutMs = 30_000 } = {}) => {
  const invocation = resolveFormalAiToolInvocation({
    tool,
    model: FORMAL_AI_MODEL_ALIAS,
    toolPath: tool,
    env,
  });
  const args = ['with', '--no-start-server', tool, '--version'];

  try {
    const result = await run(invocation.command, args, {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: timeoutMs,
    });
    return {
      valid: true,
      command: invocation.command,
      args,
      version: result?.stdout?.trim() || null,
    };
  } catch (error) {
    return {
      valid: false,
      command: invocation.command,
      args,
      error: error?.stderr?.trim() || error?.message || String(error),
      code: error?.code,
    };
  }
};

export const isPrepareOnly = argv => !!(argv?.dryRun || argv?.onlyPrepareCommand);

export const createPreparedToolResult = preparedCommand => ({
  success: true,
  preparedOnly: true,
  preparedCommand,
  sessionId: null,
  limitReached: false,
  errorDuringExecution: false,
});

export const logPreparedToolCommand = async ({ argv, fullCommand, log, formatAligned }) => {
  await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
  await log(fullCommand);
  await log('');

  if (!isPrepareOnly(argv)) return null;

  await log('🧪 Command prepared; AI execution skipped.');
  return createPreparedToolResult(fullCommand);
};
