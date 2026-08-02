#!/usr/bin/env node

/**
 * Formal AI direct-endpoint runtime (issue #2130).
 *
 * Hive Mind used to dispatch every Formal AI run through the `formal-ai with
 * <tool> <args...>` argv wrapper. That wrapper owns the wrapped CLI's argument
 * list, which is incompatible with the way Hive Mind drives agentic CLIs:
 *
 *   - `formal-ai with` parses `--model`, `--verbose`, `--silent`, `--base-url`,
 *     `--port`, `--protocol`, `--interactive` and `--non-interactive` as its own
 *     options, so those Hive Mind flags never reach the tool. A run of
 *     `formal-ai with agent --model formal-ai --verbose` launches
 *     `agent … --model formalai/formal-ai --interactive` — an interactive TUI
 *     session instead of the requested headless stream-json run.
 *   - Remaining arguments are appended *after* the wrapper's own argument list,
 *     i.e. after `--print` / `-p` / `exec`, so they are interpreted as prompt
 *     words or as a second, conflicting flag set.
 *   - When any passthrough argument contains workspace-effect vocabulary
 *     (`create`, `write`, `implement`, …) the wrapper switches into its own
 *     orchestration/recovery mode: it consumes the caller's stdin without
 *     forwarding it and replaces the prompt with a recovery prompt of its own.
 *     Hive Mind's Claude invocation always carries
 *     `--disallowedTools … CronCreate …`, so the real prompt was always dropped
 *     and Claude Code aborted with "Input must be provided either through stdin
 *     or as a prompt argument when using --print".
 *
 * The wrapper's supported shape is `formal-ai with <tool> "<prompt>"`, which
 * gives Hive Mind no control over streaming format, session resume, MCP config
 * or system prompts. This module therefore uses the other half of the same
 * upstream feature set — the parts that are explicitly machine-readable:
 *
 *   1. `formal-ai serve --agent-mode` provides the model server (agent mode is
 *      what allows tool calls; a plain `formal-ai serve` declines them).
 *      The server is started with `cwd` set to the repository clone because
 *      Formal AI absolutizes tool-call paths against the *server's* working
 *      directory.
 *   2. `formal-ai with --global --no-start-server --base-url <url> <tool>`
 *      writes the tool's own provider configuration into an isolated HOME.
 *      Upstream owns the config format, so Hive Mind never duplicates provider
 *      metadata (endpoints, wire API, model catalogs).
 *   3. Hive Mind keeps full ownership of the CLI argument list and simply runs
 *      the native binary with the environment that points it at the server.
 *
 * @module formal-ai-runtime
 */

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { rmSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const FORMAL_AI_DEFAULT_API_KEY = 'formal-ai';
// Mirrors `FORMAL_AI_MODEL_ALIAS` from `src/models/index.mjs`. Kept as a literal
// so this module stays on node builtins only — `models/index.mjs` fetches `use-m`
// from the network at import time.
export const FORMAL_AI_MODEL_NAME = 'formal-ai';
export const FORMAL_AI_DEFAULT_HOST = '127.0.0.1';
export const FORMAL_AI_SERVER_READY_TIMEOUT_MS = 90_000;

export const resolveFormalAiApiKey = (env = process.env) => env.FORMAL_AI_API_KEY?.trim() || FORMAL_AI_DEFAULT_API_KEY;

/**
 * Parse the `shell_env` config format Formal AI writes for Claude, Gemini and
 * Qwen (`export NAME="value"` lines, `${FORMAL_AI_API_KEY:-formal-ai}`
 * placeholders included).
 */
export const parseShellEnvExports = (text, { apiKey = FORMAL_AI_DEFAULT_API_KEY } = {}) => {
  const parsed = {};
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Formal AI writes `${FORMAL_AI_API_KEY:-formal-ai}` so the key stays overridable.
    value = value.replace(/\$\{FORMAL_AI_API_KEY:-([^}]*)\}/g, (_, fallback) => apiKey || fallback);
    value = value.replace(/\$\{FORMAL_AI_API_KEY\}/g, apiKey);
    parsed[name] = value;
  }
  return parsed;
};

/**
 * Gemini CLI only honours `GEMINI_DEFAULT_AUTH_TYPE` on its interactive code
 * path. Headless runs (`-p`) resolve `security.auth.selectedType` from the
 * settings hierarchy and abort with "Invalid auth method selected." when it is
 * unset, so Formal AI's shell-env-only configuration (`GEMINI_API_KEY` plus
 * `GOOGLE_GEMINI_BASE_URL` in `.profile`) is not enough.
 *
 * Hive Mind supplies the missing piece through `GEMINI_CLI_SYSTEM_SETTINGS_PATH`
 * (gemini-cli 0.53.1, `packages/cli/src/config/settings.ts`), which points the
 * *system* settings scope at a file we own. Writing `~/.gemini/settings.json`
 * would mean overriding HOME for the whole run, which would also hide the
 * operator's `git`/`gh`/ssh configuration from the tool's own shell commands.
 */
export const buildGeminiAuthSettings = () => ({ security: { auth: { selectedType: 'gemini-api-key' } } });

/**
 * Qwen Code has the same headless-auth gap as Gemini CLI, but resolves it from
 * the environment rather than from settings. `getAuthTypeFromEnv`
 * (qwen-code 0.21.2, `packages/core/src/config/models.ts`) only returns the
 * OpenAI auth type when **all three** of `OPENAI_API_KEY`, `OPENAI_BASE_URL` and
 * one of `OPENAI_MODEL` / `QWEN_MODEL` are set. Formal AI's `.profile` block
 * writes the first two, so `validateNonInteractiveAuth` aborted every run with
 * "No auth type is selected. Please configure an auth type (e.g. via settings or
 * `--auth-type`) before running in non-interactive mode."
 *
 * The model name is only read for auth detection here — `--model` on the command
 * line still wins in `resolveCliGenerationConfig` — so echoing back the model
 * Formal AI itself serves is enough to complete the triple.
 */
export const buildQwenAuthEnv = (env = {}) => (env.OPENAI_API_KEY && env.OPENAI_BASE_URL && !env.OPENAI_MODEL && !env.QWEN_MODEL ? { OPENAI_MODEL: FORMAL_AI_MODEL_NAME } : {});

const findFreePort = async (host = FORMAL_AI_DEFAULT_HOST) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(closeError => (closeError ? reject(closeError) : resolve(port)));
    });
  });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export const waitForFormalAiServerReady = async ({ baseUrl, probePath = '/api/openai/v1/models', timeoutMs = FORMAL_AI_SERVER_READY_TIMEOUT_MS, fetchImpl = globalThis.fetch, intervalMs = 500, isAlive = () => true } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (!isAlive()) return { ready: false, error: 'formal-ai serve exited before it became ready' };
    try {
      const response = await fetchImpl(`${baseUrl}${probePath}`);
      if (response.ok) return { ready: true, error: null };
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await delay(intervalMs);
  }
  return { ready: false, error: lastError || 'timed out' };
};

/** Read the machine-readable client registry (`formal-ai clients --format json`). */
export const loadFormalAiClientRegistry = async ({ formalAiPath = 'formal-ai', run = execFileAsync, env = process.env, timeoutMs = 30_000 } = {}) => {
  const result = await run(formalAiPath, ['clients', '--format', 'json'], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  const parsed = JSON.parse(result?.stdout ?? result ?? '[]');
  const clients = Array.isArray(parsed) ? parsed : parsed?.clients || [];
  return clients;
};

export const findFormalAiClient = (clients, tool) => (clients || []).find(client => client?.id === tool || (client?.aliases || []).includes(tool)) || null;

/**
 * Turn one Formal AI `global_configs` entry, materialised inside `home`, into
 * the environment a natively-invoked CLI needs.
 */
export const buildFormalAiClientEnv = async ({ client, home, apiKey = FORMAL_AI_DEFAULT_API_KEY, readFileImpl = readFile }) => {
  const env = { FORMAL_AI_API_KEY: apiKey };
  const notes = [];
  for (const config of client?.global_configs || []) {
    const absolutePath = join(home, config.path);
    if (config.format === 'shell_env') {
      let text;
      try {
        text = await readFileImpl(absolutePath, 'utf8');
      } catch {
        continue;
      }
      Object.assign(env, parseShellEnvExports(text, { apiKey }));
      notes.push(`${config.format}:${config.path}`);
      continue;
    }
    if (config.format === 'toml' && client.id === 'codex') {
      // Codex reads its whole configuration (provider, model catalog) from CODEX_HOME.
      env.CODEX_HOME = dirname(absolutePath);
      notes.push(`CODEX_HOME=${env.CODEX_HOME}`);
      continue;
    }
    if (config.format === 'json') {
      // agent/opencode read `<XDG_CONFIG_HOME>/<app>/opencode.json`.
      env.XDG_CONFIG_HOME = join(home, '.config');
      notes.push(`XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME}`);
      continue;
    }
    notes.push(`unsupported:${config.format}:${config.path}`);
  }
  if (client?.api_key_env && !env[client.api_key_env]) env[client.api_key_env] = apiKey;
  return { env, notes };
};

/**
 * Copy the operator's existing directory-based tool configuration into the
 * isolated HOME before Formal AI patches it, so authentication, plugin state
 * and MCP settings survive a Formal AI run. Upstream then merges its provider
 * block into a copy of the real config instead of a blank one.
 *
 * `shell_env` configs are deliberately skipped: `.profile` is a shell startup
 * file, and Hive Mind reads the exports back out of it — importing the
 * operator's own exports would leak unrelated environment into the CLI.
 */
export const seedFormalAiClientHome = async ({ client, home, env = process.env, realHome = homedir(), cpImpl = cp }) => {
  const seeded = [];
  for (const config of client?.global_configs || []) {
    if (config.format === 'shell_env') continue;
    const relativeDir = dirname(config.path);
    if (!relativeDir || relativeDir === '.' || relativeDir.startsWith('..')) continue;
    // Codex reads CODEX_HOME, which Hive Mind may already have repointed at a repository-scoped home (issue #2074).
    const source = client.id === 'codex' && env.CODEX_HOME ? env.CODEX_HOME : join(realHome, relativeDir);
    try {
      await cpImpl(source, join(home, relativeDir), { recursive: true, verbatimSymlinks: true, force: true });
      seeded.push(`${source} → ${relativeDir}`);
    } catch {
      // Nothing configured yet for this tool — Formal AI writes a fresh config.
    }
  }
  return seeded;
};

/** Materialise the tool's provider configuration inside an isolated HOME. */
export const configureFormalAiClientHome = async ({ tool, baseUrl, home, formalAiPath = 'formal-ai', run = execFileAsync, env = process.env, timeoutMs = 120_000 }) => {
  const args = ['with', '--global', '--no-start-server', '--base-url', baseUrl, tool];
  await run(formalAiPath, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env, HOME: home },
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { args, home };
};

/** Start `formal-ai serve --agent-mode` in `cwd` and wait until it answers. */
export const startFormalAiServer = async ({ cwd, host = FORMAL_AI_DEFAULT_HOST, port, formalAiPath = 'formal-ai', env = process.env, logFile = null, spawnImpl = spawn, readyTimeoutMs = FORMAL_AI_SERVER_READY_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) => {
  const resolvedPort = port || (await findFreePort(host));
  const args = ['serve', '--agent-mode', '--host', host, '--port', String(resolvedPort)];
  const child = spawnImpl(formalAiPath, args, {
    cwd,
    env: { ...process.env, ...env, FORMAL_AI_API_KEY: resolveFormalAiApiKey(env) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exited = false;
  let exitInfo = null;
  child.once('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });

  const chunks = [];
  const collect = chunk => {
    chunks.push(chunk.toString());
    if (chunks.length > 500) chunks.splice(0, chunks.length - 500);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const baseUrl = `http://${host}:${resolvedPort}`;
  const ready = await waitForFormalAiServerReady({ baseUrl, timeoutMs: readyTimeoutMs, fetchImpl, isAlive: () => !exited });

  const output = () => chunks.join('');
  if (!ready.ready) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    const detail = exitInfo ? ` (exit code ${exitInfo.code}, signal ${exitInfo.signal})` : '';
    throw new Error(`formal-ai serve did not become ready at ${baseUrl}${detail}: ${ready.error}\n${output().slice(-2000)}`);
  }

  if (logFile) {
    child.stdout?.on('data', chunk => void writeFile(logFile, chunk, { flag: 'a' }).catch(() => {}));
    child.stderr?.on('data', chunk => void writeFile(logFile, chunk, { flag: 'a' }).catch(() => {}));
  }

  return {
    baseUrl,
    port: resolvedPort,
    pid: child.pid,
    args,
    output,
    stop: async () => {
      if (exited) return;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      for (let attempt = 0; attempt < 20 && !exited; attempt += 1) await delay(100);
      if (!exited) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    },
  };
};

const runtimeCache = new Map();
let exitHookInstalled = false;

const installExitHook = () => {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // `exit` handlers must be synchronous, so the server is signalled and the
  // isolated HOME removed with the sync APIs.
  const stopAll = () => {
    for (const [key, entry] of runtimeCache) {
      runtimeCache.delete(key);
      try {
        if (entry.server?.pid) process.kill(entry.server.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      try {
        if (entry.runtime?.home) rmSync(entry.runtime.home, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  };
  process.once('exit', stopAll);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stopAll);
};

/**
 * Prepare everything one Formal AI tool run needs and return the environment to
 * merge into the native CLI invocation. Repeated calls for the same workspace
 * and tool reuse the same server and configuration.
 */
export const prepareFormalAiRuntime = async ({ tool, workdir, log = async () => {}, verbose = false, env = process.env, formalAiPath = null, deps = {} } = {}) => {
  const resolvedFormalAiPath = formalAiPath || env.HIVE_MIND_FORMAL_AI_PATH?.trim() || 'formal-ai';
  const cacheKey = `${tool}::${workdir}::${env.HIVE_MIND_FORMAL_AI_BASE_URL || ''}`;
  const cached = runtimeCache.get(cacheKey);
  if (cached) return cached.runtime;

  installExitHook();

  const apiKey = resolveFormalAiApiKey(env);
  const externalBaseUrl = env.HIVE_MIND_FORMAL_AI_BASE_URL?.trim() || null;
  const home = await (deps.mkdtempImpl || mkdtemp)(join(tmpdir(), `hive-formal-ai-${tool}-`));

  let server = null;
  let baseUrl = externalBaseUrl;
  try {
    if (!baseUrl) {
      await log(`🧠 Formal AI: starting a local server in ${workdir}`, { verbose: true });
      server = await (deps.startServerImpl || startFormalAiServer)({ cwd: workdir, formalAiPath: resolvedFormalAiPath, env, logFile: join(home, 'serve.log') });
      baseUrl = server.baseUrl;
      await log(`🧠 Formal AI: server ready on ${baseUrl} (pid ${server.pid})`, { verbose: true });
    } else {
      await log(`🧠 Formal AI: using the configured server ${baseUrl}`, { verbose: true });
    }

    const clients = await (deps.loadRegistryImpl || loadFormalAiClientRegistry)({ formalAiPath: resolvedFormalAiPath, env });
    const client = findFormalAiClient(clients, tool);
    if (!client) throw new Error(`Formal AI does not list a client configuration for "${tool}"`);

    const seeded = await (deps.seedImpl || seedFormalAiClientHome)({ client, home, env });
    await (deps.configureImpl || configureFormalAiClientHome)({ tool, baseUrl, home, formalAiPath: resolvedFormalAiPath, env });

    const { env: clientEnv, notes } = await buildFormalAiClientEnv({ client, home, apiKey });
    for (const entry of seeded) notes.push(`seeded ${entry}`);

    if (tool === 'gemini') {
      // Upstream gap: headless Gemini needs an explicit auth type in settings.
      // Injected through the system-settings scope so HOME stays untouched.
      const settingsPath = join(home, '.gemini', 'settings.json');
      await mkdir(dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, `${JSON.stringify(buildGeminiAuthSettings(), null, 2)}\n`);
      clientEnv.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settingsPath;
      notes.push(`GEMINI_CLI_SYSTEM_SETTINGS_PATH=${settingsPath}`);
    }

    if (tool === 'qwen') {
      // Upstream gap: Qwen Code detects the auth type from a three-variable
      // combination and Formal AI's `.profile` block only writes two of them.
      const qwenAuthEnv = buildQwenAuthEnv(clientEnv);
      Object.assign(clientEnv, qwenAuthEnv);
      for (const name of Object.keys(qwenAuthEnv)) notes.push(`${name}=${qwenAuthEnv[name]}`);
    }

    if (verbose) {
      await log(`🧠 Formal AI: protocol ${client.default_protocol}, endpoint ${baseUrl}${client.endpoints?.[client.default_protocol] || ''}`, { verbose: true });
      await log(`🧠 Formal AI: config ${notes.join(', ') || 'none'}`, { verbose: true });
      await log(`🧠 Formal AI: environment ${Object.keys(clientEnv).sort().join(', ')}`, { verbose: true });
    }

    const runtime = {
      enabled: true,
      tool,
      baseUrl,
      home,
      env: clientEnv,
      client,
      notes,
      serverStarted: !!server,
      stop: async () => {
        runtimeCache.delete(cacheKey);
        await server?.stop?.();
        await rm(home, { recursive: true, force: true }).catch(() => {});
      },
    };
    runtimeCache.set(cacheKey, { runtime, server });
    return runtime;
  } catch (error) {
    await server?.stop?.();
    await rm(home, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
};

/** Test seam: forget cached runtimes without stopping their servers. */
export const resetFormalAiRuntimeCache = () => runtimeCache.clear();
