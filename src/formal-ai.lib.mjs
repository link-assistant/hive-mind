#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { findFormalAiClient, loadFormalAiClientRegistry, prepareFormalAiRuntime } from './formal-ai-runtime.lib.mjs';
import { assertSupportedFormalAiVersion, parseFormalAiVersion, readFormalAiBinaryVersion } from './formal-ai-version.lib.mjs';
import { isFormalAiModel } from './models/index.mjs';

const execFileAsync = promisify(execFile);

export const FORMAL_AI_SUPPORTED_TOOLS = Object.freeze(['claude', 'agent', 'opencode', 'codex', 'qwen', 'gemini']);
export const DEFAULT_FORMAL_AI_PATH = 'formal-ai';

const SAFE_SHELL_WORD = /^[a-zA-Z0-9_\-./=,+@:]+$/;

const shellQuote = value => {
  const stringValue = String(value);
  if (SAFE_SHELL_WORD.test(stringValue)) return stringValue;
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
};

export const normalizeFormalAiBaseUrl = value => {
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

export const resolveFormalAiPath = (env = process.env) => env.HIVE_MIND_FORMAL_AI_PATH?.trim() || DEFAULT_FORMAL_AI_PATH;

const nativeInvocation = toolPath => ({
  command: toolPath,
  args: [],
  displayCommand: shellQuote(toolPath),
  formalAi: false,
  baseUrl: null,
  env: {},
  stop: null,
});

/**
 * Resolve how one Hive tool invocation reaches Formal AI (issue #2130).
 *
 * Hive Mind runs the *native* CLI and only injects the environment that points
 * it at a Formal AI server. The `formal-ai with <tool> <args…>` argv wrapper is
 * deliberately not used any more: it claims `--model`/`--verbose` for itself,
 * appends Hive Mind's flags after its own `--print`/`-p`/`exec`, and drops the
 * piped prompt whenever an argument contains workspace-effect vocabulary (Hive
 * Mind's `--disallowedTools … CronCreate …` always matched). See
 * ./formal-ai-runtime.lib.mjs for the full analysis and the replacement.
 */
export const resolveFormalAiToolExecution = async ({ tool, model, toolPath, workdir, log = async () => {}, verbose = false, prepareOnly = false, env = process.env, deps = {} } = {}) => {
  if (!isFormalAiModel(model)) return nativeInvocation(toolPath);

  if (!FORMAL_AI_SUPPORTED_TOOLS.includes(tool)) {
    throw new Error(`Formal AI dispatch does not support Hive tool "${tool}"`);
  }

  // Validated here so a malformed override fails fast with a clear message.
  const configuredBaseUrl = normalizeFormalAiBaseUrl(env.HIVE_MIND_FORMAL_AI_BASE_URL);

  // `--dry-run` / `--only-prepare-command` must not start a server or write config.
  if (prepareOnly) {
    return { ...nativeInvocation(toolPath), formalAi: true, baseUrl: configuredBaseUrl, prepared: true };
  }

  const runtime = await (deps.prepareRuntimeImpl || prepareFormalAiRuntime)({
    tool,
    workdir,
    log,
    verbose,
    env,
  });

  return {
    command: toolPath,
    args: [],
    displayCommand: shellQuote(toolPath),
    formalAi: true,
    baseUrl: runtime.baseUrl,
    env: runtime.env,
    home: runtime.home,
    client: runtime.client,
    // Issue #2208: provenance names the backend that answered, and the local
    // wrapper under its own name — the two are not interchangeable.
    backend: runtime.backend,
    formalAiVersion: runtime.formalAiVersion,
    formalAiWrapperVersion: runtime.formalAiWrapperVersion,
    stop: runtime.stop,
  };
};

/**
 * Render `toolInvocation.env` as `export NAME=value; ` shell prefixes (issue #2130).
 *
 * Tools launched through `sh -lc` (codex, qwen) get a login shell that sources the
 * operator's `~/.profile`, which may still hold stale exports written by an earlier
 * `formal-ai with --global` run. Re-exporting inside the script makes this run's
 * values win regardless of what the profile sets.
 */
export const buildFormalAiEnvExports = env =>
  Object.entries(env || {})
    .map(([name, value]) => `export ${name}=${shellQuote(value)}; `)
    .join('');

/**
 * `formal-ai --version` prints a line such as "formal-ai 0.317.0"; keep only the
 * version so the log records a value that can be compared against a release.
 */
export { parseFormalAiVersion };

/**
 * The wrapper's behaviour changes between releases — issue #2130's round-2
 * failures could not be pinned to a mechanism because no log recorded which
 * wrapper produced them. This shared reader remains non-throwing so connection
 * validation and runtime preparation can apply one actionable support policy.
 */
export const readFormalAiVersion = async ({ env = process.env, run = execFileAsync, timeoutMs = 30_000 } = {}) => {
  return readFormalAiBinaryVersion({ formalAiPath: resolveFormalAiPath(env), env, run, timeoutMs });
};

/**
 * Check that the Formal AI wrapper and the selected native CLI are both usable
 * without starting a model server or spending a model request.
 */
export const validateFormalAiToolConnection = async (tool, { env = process.env, run = execFileAsync, timeoutMs = 30_000 } = {}) => {
  const command = resolveFormalAiPath(env);
  const args = ['clients', '--format', 'json'];
  const formalAiVersion = await readFormalAiVersion({ env, run, timeoutMs });

  try {
    assertSupportedFormalAiVersion(formalAiVersion);
  } catch (error) {
    return { valid: false, command, args, formalAiVersion, error: error.message };
  }

  let clients;
  try {
    clients = await loadFormalAiClientRegistry({ formalAiPath: command, run, env, timeoutMs });
  } catch (error) {
    return {
      valid: false,
      command,
      args,
      formalAiVersion,
      error: error?.stderr?.trim() || error?.message || String(error),
      code: error?.code,
    };
  }

  const client = findFormalAiClient(clients, tool);
  if (!client) {
    return {
      valid: false,
      command,
      args,
      formalAiVersion,
      error: `Formal AI does not list a client configuration for "${tool}" (available: ${(clients || []).map(entry => entry.id).join(', ')})`,
    };
  }

  try {
    const result = await run(tool, ['--version'], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: timeoutMs });
    return {
      valid: true,
      command,
      args,
      client: client.id,
      protocol: client.default_protocol,
      formalAiVersion,
      version: result?.stdout?.trim() || null,
    };
  } catch (error) {
    return {
      valid: false,
      command,
      args,
      formalAiVersion,
      error: error?.stderr?.trim() || error?.message || String(error),
      code: error?.code,
    };
  }
};

/**
 * Vendor login remedies (`codex login`, `claude /login`, …) are wrong advice
 * when the model is served by Formal AI: the CLI never talks to the vendor, so
 * logging in changes nothing. Issue #2130's codex run printed
 * "❌ Codex authentication failed - 401 Unauthorized … 💡 Please run: codex
 * login" while the real cause was that the request went to `api.openai.com`
 * instead of the Formal AI endpoint.
 *
 * @param {object} params
 * @param {string} params.model - the model the run was launched with.
 * @param {string} params.vendorRemedy - the advice to keep for vendor models.
 * @returns {string[]} remedy lines, already indented for the error log.
 */
export const buildAuthRemedyLines = ({ model, vendorRemedy }) => {
  if (!isFormalAiModel(model)) return [`   💡 ${vendorRemedy}`];
  return ['   💡 This model is served by Formal AI, so a vendor login will not help.', '   💡 Check that `formal-ai serve --agent-mode` is reachable and that the generated client config is in effect (rerun with --verbose to see the endpoint and environment).'];
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

const FORMAL_AI_NON_EXECUTION_PATTERNS = [/^\s*planned,\s*not executed\b/im, /^\s*planned_not_executed\s*$/im, /^\s*terminal_state\s+["']?planned_not_executed\b/im];

/**
 * Turn Formal AI's explicit non-execution terminal state into a failed tool
 * result (issue #2158).
 *
 * Formal AI 0.339.1 truthfully reports repository work as
 * `planned_not_executed`, but each native CLI exits zero. Treating that process
 * exit as a successful solve made `--auto-restart-until-mergeable` repeat the
 * same deterministic plan five times. Keep the model's summary for evidence,
 * while giving Hive Mind an actionable terminal failure.
 */
export const classifyFormalAiToolResult = ({ model, toolResult } = {}) => {
  if (!toolResult || !isFormalAiModel(model) || toolResult.success === false) return toolResult;

  const evidence = [toolResult.resultSummary, toolResult.result, toolResult.lastMessage, toolResult.output].filter(value => typeof value === 'string').join('\n');
  if (!FORMAL_AI_NON_EXECUTION_PATTERNS.some(pattern => pattern.test(evidence))) return toolResult;

  return {
    ...toolResult,
    success: false,
    errorDuringExecution: true,
    formalAiNonExecution: true,
    errorInfo: {
      code: 'FORMAL_AI_PLANNED_NOT_EXECUTED',
      message: "Formal AI did not execute repository work; it returned the terminal state planned_not_executed. Fix or upgrade Formal AI's repository-work executor before retrying.",
    },
  };
};

export const logPreparedToolCommand = async ({ argv, fullCommand, log, formatAligned }) => {
  await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
  await log(fullCommand);
  await log('');

  if (!isPrepareOnly(argv)) return null;

  await log('🧪 Command prepared; AI execution skipped.');
  return createPreparedToolResult(fullCommand);
};
