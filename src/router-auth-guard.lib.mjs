/**
 * Router auth guard (issue #2190).
 *
 * A task launched with `--use-router` holds exactly one credential: the
 * `la_sk_…` token the router minted for it. Every request it makes is meant to
 * carry that token and nothing else, so that the audit trail is complete and
 * the task can be cut off by revoking one token. The issue states the rule
 * plainly: "we use only its token and no other way of auth", and a task that
 * reconfigures itself onto another credential "must fail immediately … it is
 * clearly a security violation".
 *
 * The vendor CLIs read their credentials from files, so that is where the
 * guard looks. It runs inside the task (in `solve`, next to the CLI process),
 * takes a baseline before the CLI starts and re-reads the credential surface
 * on a short interval while the CLI is running:
 *
 * - Claude Code: `~/.claude/.credentials.json` (OAuth), the auth keys of
 *   `~/.claude.json` (`primaryApiKey`, `oauthAccount`, approved custom keys),
 *   and `apiKeyHelper` / `env.ANTHROPIC_*` overrides in any settings file.
 * - Codex: `$CODEX_HOME/auth.json` (API key or ChatGPT tokens) and the provider
 *   pin in `$CODEX_HOME/config.toml` that the wiring wrote.
 * - Git and gh, for every tool: `~/.netrc`, `~/.git-credentials`, a gh
 *   `hosts.yml` holding an `oauth_token`.
 *
 * None of these exist in a routed container — the credential mounts are
 * withheld (`getRouterSuppressedCredentialPaths`) — so their appearance is, by
 * construction, the task writing them. On a hit the caller kills the CLI and
 * `solve` exits with {@link EXIT_CODE_ROUTER_AUTH_VIOLATION}.
 *
 * Not a sandbox: a task can still hold a token in memory. What this closes is
 * the persistent, CLI-honoured configuration paths — the ones through which a
 * "helpful" agent that finds a credential in the environment would actually
 * redirect its own traffic. Polling rather than `fs.watch` because the files
 * may not exist yet, watchers on a missing parent are unreliable, and one stat
 * per file per second is negligible next to an LLM call.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2190
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { parse as parseToml } from 'smol-toml';
import { resolveClaudeConfigDirectory, resolveClaudeCredentialDirectory } from './claude-paths.lib.mjs';

/** `solve` exits with this when the guard fires: distinct from 1 (tool failure) and 75 (disk), so a supervisor can tell a security stop from a crash. */
export const EXIT_CODE_ROUTER_AUTH_VIOLATION = 77;
export const DEFAULT_ROUTER_AUTH_GUARD_INTERVAL_MS = 1000;
/** Codex provider id the wiring pins; see buildRouterCodexConfig in router-isolation.lib.mjs. */
export const ROUTER_CODEX_PROVIDER_ID = 'hive-mind-router';

const CLAUDE_TOOLS = new Set(['claude', 'agent']);
const isFalsey = value =>
  ['0', 'false', 'no', 'off'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase()
  );
const isTruthy = value => value !== undefined && value !== null && String(value).trim() !== '' && !isFalsey(value);
const normalizeTool = tool => String(tool || 'claude').toLowerCase();

/** Claude Code settings `env` keys that select a credential or an endpoint; any value that differs from the routed process env is a redirection. */
export const CLAUDE_SETTINGS_AUTH_ENV_KEYS = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_FOUNDRY_BASE_URL', 'AWS_BEARER_TOKEN_BEDROCK', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_HOST_CREDS_FILE', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR']);

/**
 * Is the guard required for this process?
 *
 * Router selection requires the guard even when its task token is missing.
 * The legacy HIVE_MIND_ROUTER_AUTH_GUARD switch cannot waive this requirement.
 */
export const isRouterAuthGuardRequired = (env = process.env) => isTruthy(env?.HIVE_MIND_USE_ROUTER);

export const resolveRouterAuthGuardIntervalMs = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.HIVE_MIND_ROUTER_AUTH_GUARD_INTERVAL_MS || ''), 10);
  return Number.isFinite(parsed) && parsed >= 100 ? Math.min(parsed, DEFAULT_ROUTER_AUTH_GUARD_INTERVAL_MS) : DEFAULT_ROUTER_AUTH_GUARD_INTERVAL_MS;
};

const readText = (fsImpl, filePath) => {
  let fd;
  try {
    // A task can replace these paths. Never block on a FIFO, follow a symlink
    // or read an unbounded file while deciding whether authentication is safe.
    fd = fsImpl.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
    const info = fsImpl.fstatSync(fd);
    const limit = 1024 * 1024;
    if (!info.isFile() || info.size > limit) throw new Error('Unsafe Router authentication surface');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fsImpl.readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (length > limit) throw new Error('Oversized Router authentication surface');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (fd !== undefined) fsImpl.closeSync(fd);
  }
};

const parseJson = text => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isNonEmptyString = value => typeof value === 'string' && value.trim() !== '';

/**
 * The checks for one tool, each `{ path, check(text) }` where `check` returns
 * a reason string for a violation or null. `text` is null when the file is
 * absent. Kept as data so the surface is inspectable and testable on its own.
 */
export const describeRouterAuthSurface = ({ tool = 'claude', env = process.env, homeDir = env?.HOME || os.homedir(), cwd = process.cwd() } = {}) => {
  const normalizedTool = normalizeTool(tool);
  const entries = [];
  const forbidden = (filePath, what) => entries.push({ path: filePath, kind: 'forbidden', check: text => (text === null ? null : `${what} appeared; a routed task authenticates with its router token only`) });

  if (CLAUDE_TOOLS.has(normalizedTool)) {
    const conventional = path.join(homeDir, '.claude');
    const config = resolveClaudeConfigDirectory(env, homeDir);
    for (const root of new Set([conventional, config, resolveClaudeCredentialDirectory(env, homeDir)])) forbidden(path.join(root, '.credentials.json'), 'a Claude OAuth credential file');
    for (const statePath of new Set([path.join(homeDir, '.claude.json'), path.join(config, '.claude.json')]))
      entries.push({
        path: statePath,
        kind: 'claude-json',
        check: text => {
          if (text === null) return null;
          const data = parseJson(text);
          if (!data || typeof data !== 'object') return null;
          if (isNonEmptyString(data.primaryApiKey)) return 'primaryApiKey was set in ~/.claude.json';
          if (data.oauthAccount && typeof data.oauthAccount === 'object') return 'an oauthAccount was recorded in ~/.claude.json';
          if (Array.isArray(data.customApiKeyResponses?.approved) && data.customApiKeyResponses.approved.length > 0) return 'a custom API key was approved in ~/.claude.json';
          return null;
        },
      });
    for (const settingsPath of new Set([conventional, config, path.join(cwd, '.claude')].flatMap(root => ['settings.json', 'settings.local.json'].map(file => path.join(root, file))))) {
      entries.push({
        path: settingsPath,
        kind: 'claude-settings',
        check: text => {
          if (text === null) return null;
          const data = parseJson(text);
          if (!data || typeof data !== 'object' || Array.isArray(data)) return 'a Claude settings file could not be inspected as a JSON object';
          if (isNonEmptyString(data.apiKeyHelper)) return 'apiKeyHelper was configured in a Claude settings file';
          if (data.env !== undefined && (!data.env || typeof data.env !== 'object' || Array.isArray(data.env))) return 'the Claude settings env field could not be inspected as a JSON object';
          const overrides = data.env && typeof data.env === 'object' ? data.env : {};
          for (const key of CLAUDE_SETTINGS_AUTH_ENV_KEYS) {
            if (!(key in overrides)) continue;
            if (String(overrides[key] ?? '') !== String(env?.[key] ?? '')) return `${key} was overridden in a Claude settings file`;
          }
          return null;
        },
      });
    }
  }

  if (normalizedTool === 'codex') {
    const codexHome = String(env?.CODEX_HOME || '').trim() || path.join(homeDir, '.codex');
    entries.push({
      path: path.join(codexHome, 'auth.json'),
      kind: 'codex-auth',
      check: text => {
        if (text === null) return null;
        const data = parseJson(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return 'an unreadable Codex auth.json appeared';
        if (isNonEmptyString(data?.OPENAI_API_KEY)) return 'an OPENAI_API_KEY was written to Codex auth.json';
        if (data?.tokens && typeof data.tokens === 'object') return 'ChatGPT tokens were written to Codex auth.json';
        return null;
      },
    });
    entries.push({
      path: path.join(codexHome, 'config.toml'),
      kind: 'codex-config',
      check: text => {
        if (text === null) return 'the Codex config.toml that pins the router provider was removed';
        const pin = readCodexProviderPin(text);
        if (pin.modelProvider !== ROUTER_CODEX_PROVIDER_ID) return 'Codex model_provider was changed or removed';
        const expectedBaseUrl = String(env?.OPENAI_BASE_URL || '').trim();
        if (!expectedBaseUrl || pin.baseUrl !== expectedBaseUrl) return 'the router provider base_url was changed or removed';
        if (pin.envKey !== 'OPENAI_API_KEY') return 'the router provider env_key was changed or removed';
        if (pin.experimentalBearerToken) return 'a bearer token was pinned into the router provider entry';
        return null;
      },
    });
    entries.push({
      path: path.join(cwd, '.codex', 'config.toml'),
      kind: 'codex-project-config',
      check: text => (text !== null && hasCodexProviderOverride(parseToml(text, { maxDepth: 64 })) ? 'a project-level Codex config redirects the provider' : null),
    });
  }

  forbidden(path.join(homeDir, '.netrc'), 'a ~/.netrc');
  forbidden(path.join(homeDir, '.git-credentials'), 'a ~/.git-credentials store');
  forbidden(path.join(cwd, '.netrc'), 'a .netrc in the workspace');
  const ghConfigDir = String(env?.GH_CONFIG_DIR || '').trim() || path.join(homeDir, '.config', 'gh');
  entries.push({ path: path.join(ghConfigDir, 'hosts.yml'), kind: 'gh-hosts', check: text => (text !== null && /^\s*oauth_token\s*:/m.test(text) ? 'a gh oauth_token was stored in hosts.yml' : null) });
  return entries;
};

/**
 * The provider pin from a Codex config.toml: `model_provider` at the top level
 * and `base_url` / `env_key` under `[model_providers.hive-mind-router]`. A
 * real TOML parse preserves quoted/dotted keys and ignores unrelated project
 * trust settings. Inspection errors are refused without exposing source text.
 */
export const readCodexProviderPin = text => {
  const config = parseToml(String(text), { maxDepth: 64 });
  const provider = config.model_providers?.[ROUTER_CODEX_PROVIDER_ID];
  return { modelProvider: config.model_provider ?? null, baseUrl: provider?.base_url, envKey: provider?.env_key, experimentalBearerToken: Boolean(provider?.experimental_bearer_token) };
};

const hasCodexProviderOverride = value => {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => ['model_provider', 'model_providers', 'base_url', 'env_key', 'experimental_bearer_token'].includes(key) || hasCodexProviderOverride(entry));
};

/**
 * Read the whole surface once.
 *
 * @returns {{ violations: Array<{path: string, kind: string, reason: string}>, checked: number }}
 */
export const inspectRouterAuthSurface = ({ tool = 'claude', env = process.env, homeDir = env?.HOME || os.homedir(), cwd = process.cwd(), fsImpl = fs, surface = null } = {}) => {
  const violations = [];
  if (isRouterAuthGuardRequired(env) && !String(env?.HIVE_MIND_ROUTER_TOKEN || '').trim()) violations.push({ path: '(router task environment)', kind: 'router-token', reason: 'the router task token is missing' });
  let entries;
  try {
    entries = surface || describeRouterAuthSurface({ tool, homeDir, cwd, env });
  } catch {
    return { violations: [...violations, { path: '(router task environment)', kind: 'inspection', reason: 'the Router credential paths could not be resolved safely' }], checked: 0 };
  }
  for (const entry of entries) {
    let reason;
    try {
      reason = entry.check(readText(fsImpl, entry.path));
    } catch {
      reason = 'the Router credential surface could not be inspected safely';
    }
    if (reason) violations.push({ path: entry.path, kind: entry.kind, reason });
  }
  return { violations, checked: entries.length };
};

export const formatRouterAuthViolation = violation => {
  const first = violation?.violations?.[0];
  if (!first) return 'router auth guard: security violation';
  const extra = violation.violations.length > 1 ? ` (+${violation.violations.length - 1} more)` : '';
  return `Security violation (issue #2190): ${first.reason} — ${first.path}${extra}. A task run with --use-router may authenticate only with its router token; the session was stopped.`;
};

/** Refuse before command-stream creates the native process, including resumes. */
export const assertRouterTaskAuthentication = (options = {}) => {
  if (!isRouterAuthGuardRequired(options.env ?? process.env)) return;
  const { violations } = inspectRouterAuthSurface(options);
  if (violations.length === 0) return;
  const violation = { violations, detectedAt: new Date().toISOString(), tool: normalizeTool(options.tool) };
  throw Object.assign(new Error(formatRouterAuthViolation(violation)), { code: 'ROUTER_AUTH_VIOLATION', routerAuthViolation: violation });
};

/**
 * Start watching. Returns a handle whose `violation` is set once a check
 * fails; `onViolation` is invoked exactly once, with the checks that fired.
 *
 * Call assertRouterTaskAuthentication before launching, then start this guard
 * to detect persistent changes while the command runs. The first monitoring
 * result is available through handle.first.
 */
export const startRouterAuthGuard = ({ tool = 'claude', env = process.env, homeDir = env?.HOME || os.homedir(), cwd = process.cwd(), fsImpl = fs, log = null, onViolation = null, intervalMs = null, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) => {
  const inactive = { active: false, violation: null, first: Promise.resolve(null), check: async () => null, stop: () => {} };
  if (!isRouterAuthGuardRequired(env)) return inactive;
  const handle = { active: true, violation: null, checks: 0, check: null, stop: null };
  let checkedPaths = 0;
  let timer = null;
  let firing = null;
  const fire = async violations => {
    if (handle.violation) return handle.violation;
    handle.violation = { violations, detectedAt: new Date().toISOString(), tool: normalizeTool(tool) };
    if (timer) {
      clearIntervalImpl(timer);
      timer = null;
    }
    if (onViolation) {
      firing = Promise.resolve(onViolation(handle.violation)).catch(error => {
        if (log) return log(`⚠️ Router auth guard handler failed: ${error?.message || error}`);
        return null;
      });
      await firing;
    }
    return handle.violation;
  };
  handle.check = async () => {
    if (handle.violation) return handle.violation;
    handle.checks += 1;
    const { violations, checked } = inspectRouterAuthSurface({ tool, homeDir, cwd, env, fsImpl });
    checkedPaths = checked;
    return violations.length > 0 ? fire(violations) : null;
  };
  handle.stop = () => {
    if (timer) clearIntervalImpl(timer);
    timer = null;
  };
  timer = setIntervalImpl(
    () => {
      handle.check().catch(error => {
        if (log) log(`⚠️ Router auth guard check failed: ${error?.message || error}`);
      });
    },
    intervalMs || resolveRouterAuthGuardIntervalMs(env)
  );
  if (typeof timer?.unref === 'function') timer.unref();
  handle.first = handle.check().catch(error => {
    if (log) log(`⚠️ Router auth guard check failed: ${error?.message || error}`);
    return null;
  });
  if (log) log(`🛡️ Router auth guard armed: ${checkedPaths} credential path(s) watched every ${intervalMs || resolveRouterAuthGuardIntervalMs(env)} ms (issue #2190)`, { verbose: true });
  return handle;
};

export default { EXIT_CODE_ROUTER_AUTH_VIOLATION, assertRouterTaskAuthentication, describeRouterAuthSurface, formatRouterAuthViolation, inspectRouterAuthSurface, isRouterAuthGuardRequired, readCodexProviderPin, startRouterAuthGuard };
