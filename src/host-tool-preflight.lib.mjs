/** Host checks run before image pulls, sidecars and task containers (issue #2631). */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getDefaultModelForTool, isFormalAiModel } from './models/index.mjs';
import { resolveRuntimeCodexReasoningEffort } from './codex.reasoning.lib.mjs';

const execFileAsync = promisify(execFile);
const blocks = new Map();
const inFlight = new Map();
const loginMessage = tool => `${tool} needs operator re-login on the host: run \`${tool === 'claude' ? 'claude /login' : 'codex login'}\`. The ${tool} queue is paused until credentials change.`;
const launchFailure = tool => ({ success: false, failureKind: 'auth', error: `${loginMessage(tool)} No task container was created.` });
const authPath = (tool, { env = process.env, homeDir = homedir() } = {}) => (tool === 'codex' ? join(env.CODEX_HOME || join(homeDir, '.codex'), 'auth.json') : join(env.CLAUDE_CONFIG_DIR || join(homeDir, '.claude'), '.credentials.json'));
const fingerprint = async (tool, options) => {
  try {
    return createHash('sha256')
      .update(await readFile(authPath(tool, options)))
      .digest('hex');
  } catch {
    return 'missing';
  }
};

export async function markHostAuthenticationBlocked(tool, options = {}) {
  if (!['claude', 'codex'].includes(tool)) return;
  blocks.set(tool, { fingerprint: await fingerprint(tool, options), options, message: loginMessage(tool) });
}

export async function getHostAuthenticationBlock(tool) {
  if ((tool === 'claude' && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) || (tool === 'codex' && process.env.OPENAI_API_KEY)) return null;
  const block = blocks.get(tool);
  if (!block) return null;
  if ((await fingerprint(tool, block.options)) !== block.fingerprint) {
    blocks.delete(tool);
    return null;
  }
  return block.message;
}

export function parseHostToolOptions(args = [], options = {}) {
  const parsed = { tool: options.tool || 'claude', model: options.model, useRouter: options.useRouter };
  const names = { '--tool': 'tool', '--model': 'model', '-m': 'model', '--think': 'think', '--thinking-budget': 'thinkingBudget', '--max-thinking-budget': 'maxThinkingBudget', '--codex-path': 'codexPath' };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--') break;
    const [flag, ...rest] = args[index].split('=');
    if (flag === '--use-router') parsed.useRouter = rest.length ? rest.join('=') !== 'false' : true;
    if (flag === '--no-use-router') parsed.useRouter = false;
    if (!names[flag]) continue;
    const value = rest.length ? rest.join('=') : args[++index];
    parsed[names[flag]] = flag.includes('budget') ? Number(value) : value;
  }
  parsed.model ||= getDefaultModelForTool(parsed.tool);
  return parsed;
}

export function usesHostSubscription(args = [], options = {}) {
  const parsed = parseHostToolOptions(args, options);
  const env = options.env || process.env;
  const routed = parsed.useRouter ?? /^(1|true|yes)$/i.test(env.HIVE_MIND_USE_ROUTER || '');
  return ['claude', 'codex'].includes(parsed.tool) && !isFormalAiModel(parsed.model) && !routed;
}

const defaultFetchLimits = async (tool, path) => {
  const limits = await import('./limits.lib.mjs');
  const signal = AbortSignal.timeout(15000);
  return tool === 'claude' ? limits.getClaudeUsageLimits(false, path, { signal }) : limits.getCodexUsageLimits(false, path, null, { signal });
};

// A fresh CLI process can refresh OAuth using the host's current credential file.
// Never retry indefinitely or expose its output; the usage probe decides whether access recovered.
const defaultRefresh = async ({ tool, model, env, reasoningEffort, codexPath }) => {
  const args = tool === 'claude' ? ['--model', model, '-p', 'Reply with OK.'] : ['exec', '--model', model, '--json', '--skip-git-repo-check', ...(reasoningEffort ? ['-c', `model_reasoning_effort=${reasoningEffort}`] : []), 'Reply with OK.'];
  try {
    await execFileAsync(tool === 'codex' ? codexPath || env.CODEX_PATH || tool : env.CLAUDE_PATH || tool, args, { env, timeout: 20000, maxBuffer: 1024 * 1024 });
  } catch {
    // Re-read even on failure: another worker may have refreshed the shared credentials.
  }
};

export async function preflightHostTool(args, options = {}, dependencies = {}) {
  const env = options.env || process.env;
  const parsed = parseHostToolOptions(args, options);
  const { tool, model } = parsed;
  if (!usesHostSubscription(args, { ...options, env })) return { success: true, skipped: true };
  let reasoning = null;
  if (tool === 'codex') {
    try {
      reasoning = await (dependencies.resolveReasoning || resolveRuntimeCodexReasoningEffort)(parsed, { env });
    } catch (error) {
      return { success: false, error: error.message, failureKind: 'model_configuration' };
    }
  }
  const path = authPath(tool, { ...options, env });
  // API-key accounts do not expose OAuth usage windows; avoid calling that endpoint for them.
  if ((tool === 'claude' && (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)) || (tool === 'codex' && env.OPENAI_API_KEY)) return { success: true, reasoning, skipped: true };
  try {
    const auth = JSON.parse(await (dependencies.readFile || readFile)(path, 'utf8'));
    if (tool === 'codex' && (auth.OPENAI_API_KEY || (auth.auth_mode && auth.auth_mode !== 'chatgpt'))) return { success: true, reasoning, skipped: true };
  } catch {
    await markHostAuthenticationBlocked(tool, { ...options, env });
    return launchFailure(tool);
  }
  const key = `${tool}:${path}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const check = async () => {
    const fetchLimits = dependencies.fetchLimits || defaultFetchLimits;
    const probe = async () => {
      try {
        return await fetchLimits(tool, path);
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
    let result = await probe();
    if (result.failureKind === 'auth') {
      await (dependencies.refresh || defaultRefresh)({ tool, model, env, codexPath: parsed.codexPath, reasoningEffort: reasoning?.reasoningEffort });
      result = await probe(); // reads the host file again; exactly one retry
    }
    if (result.failureKind === 'auth') {
      await markHostAuthenticationBlocked(tool, { ...options, env });
      return launchFailure(tool);
    }
    // Usage API 429s/outages do not prove bad credentials and must not pause the queue.
    blocks.delete(tool);
    return { success: true, reasoning, advisory: result.success ? null : result.error };
  };
  const pending = check();
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(key);
  }
}
