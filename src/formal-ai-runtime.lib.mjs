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
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { assertSupportedFormalAiVersion, FORMAL_AI_MINIMUM_VERSION, isFormalAiVersionAtLeast, readFormalAiBinaryVersion } from './formal-ai-version.lib.mjs';

const execFileAsync = promisify(execFile);

export const FORMAL_AI_DEFAULT_API_KEY = 'formal-ai';
// Mirrors `FORMAL_AI_MODEL_ALIAS` from `src/models/index.mjs`. Kept as a literal
// so this module stays on node builtins only — `models/index.mjs` fetches `use-m`
// from the network at import time.
export const FORMAL_AI_MODEL_NAME = 'formal-ai';
export const FORMAL_AI_DEFAULT_HOST = '127.0.0.1';
export const FORMAL_AI_SERVER_READY_TIMEOUT_MS = 90_000;

/** Where a Formal AI server reports its own version and memory compatibility. */
export const FORMAL_AI_HEALTH_PATH = '/health';

/**
 * Bounded budget for the backend probe (issue #2208).
 *
 * Deliberately short: this runs immediately before the client executes, so a
 * hanging endpoint must surface as a refusal rather than as a task that appears
 * to be thinking. The server-start path has its own, much longer budget.
 */
export const FORMAL_AI_BACKEND_PROBE_TIMEOUT_MS = 15_000;

/** Environment carrying the Hive-Mind-managed sidecar's identity into the task container (issue #2207/#2208). */
export const FORMAL_AI_SIDECAR_PROVENANCE_ENV = Object.freeze({
  image: 'HIVE_MIND_FORMAL_AI_SIDECAR_IMAGE',
  imageDigest: 'HIVE_MIND_FORMAL_AI_SIDECAR_DIGEST',
  version: 'HIVE_MIND_FORMAL_AI_SIDECAR_VERSION',
  imageSource: 'HIVE_MIND_FORMAL_AI_SIDECAR_SOURCE',
});

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

/**
 * Root for the throwaway HOME each Formal AI run gets.
 *
 * Not `os.tmpdir()`: Codex refuses to install its PATH helper binaries when
 * `CODEX_HOME` resolves under the system temporary directory and prints
 * `WARNING: proceeding, even though we could not create PATH aliases: Refusing
 * to create helper binaries under temporary dir "/tmp"` on every run
 * (codex-cli 0.146.0). A cache directory under the operator's HOME is outside
 * that check and is still disposable — `stop()` and the exit hook remove it.
 */
export const resolveFormalAiHomeRoot = (env = process.env, realHome = homedir()) => env.HIVE_MIND_FORMAL_AI_HOME_ROOT?.trim() || join(realHome, '.cache', 'hive-mind', 'formal-ai');

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

/**
 * Ask the endpoint that will actually answer the model requests who it is
 * (issue #2208).
 *
 * Until this existed, `prepareFormalAiRuntime` read `formal-ai --version` from
 * the *local* executable and logged the answer as "the Formal AI version" even
 * when `HIVE_MIND_FORMAL_AI_BASE_URL` pointed at a container running a
 * completely different release. Every provenance record therefore named a binary
 * that never saw the request.
 *
 * Properties that matter:
 *
 *  - **Bounded.** The whole probe shares one deadline, and each request carries
 *    its own abort signal, so an endpoint that accepts the connection and then
 *    goes quiet cannot stall the task.
 *  - **Authenticated.** The configured key is presented the way the served API
 *    expects it. A 401/403 is reported as an authentication problem and is *not*
 *    retried — retrying a rejected credential only delays the failure.
 *  - **Honest about malformed answers.** A body that is not JSON, or that
 *    carries no version, is a distinct outcome from "unreachable"; guessing a
 *    version here would recreate the defect this function exists to fix.
 *
 * @returns {Promise<{ok: boolean, kind: string, status: number|null, version: string|null, memory: object|null, health: object|null, error: string|null}>}
 */
export const probeFormalAiBackend = async ({ baseUrl, apiKey = null, path = FORMAL_AI_HEALTH_PATH, timeoutMs = FORMAL_AI_BACKEND_PROBE_TIMEOUT_MS, fetchImpl = globalThis.fetch, intervalMs = 500, now = () => Date.now(), sleepImpl = delay } = {}) => {
  if (!baseUrl) return { ok: false, kind: 'unreachable', status: null, version: null, memory: null, health: null, error: 'no base URL to probe' };
  const url = `${String(baseUrl).replace(/\/+$/, '')}${path}`;
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey } : {};
  const deadline = now() + timeoutMs;
  let last = { ok: false, kind: 'unreachable', status: null, version: null, memory: null, health: null, error: 'not probed' };

  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    try {
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(Math.min(remaining, timeoutMs)) });
      const status = response?.status ?? null;
      if (status === 401 || status === 403) {
        // Not retried: the credential is wrong, and it will still be wrong in 500ms.
        return { ok: false, kind: 'unauthorized', status, version: null, memory: null, health: null, error: `the Formal AI endpoint rejected the configured credentials (HTTP ${status})` };
      }
      if (!response?.ok) {
        last = { ok: false, kind: 'http-error', status, version: null, memory: null, health: null, error: `HTTP ${status}` };
      } else {
        const text = await response.text();
        let health;
        try {
          health = JSON.parse(text);
        } catch {
          return { ok: false, kind: 'malformed', status, version: null, memory: null, health: null, error: `${path} did not return JSON: ${text.slice(0, 200)}` };
        }
        const version = typeof health?.version === 'string' ? health.version.trim() || null : null;
        if (!version) return { ok: false, kind: 'no-version', status, version: null, memory: health?.memory ?? null, health, error: `${path} answered without a version field` };
        return { ok: true, kind: 'ok', status, version, memory: health?.memory ?? null, health, error: null };
      }
    } catch (error) {
      last = { ok: false, kind: 'unreachable', status: null, version: null, memory: null, health: null, error: error?.message || String(error) };
    }
    if (deadline - now() <= intervalMs) break;
    await sleepImpl(intervalMs);
  }
  return last;
};

/**
 * Turn a probe result into either the accepted backend description or an
 * actionable refusal.
 *
 * Fail-closed (issue #2146) applies here too: a Formal AI task that cannot prove
 * which release is serving it must stop, not proceed and record a guess.
 *
 * @param {object} probe - Output of {@link probeFormalAiBackend}.
 * @param {object} context
 * @param {string} context.baseUrl
 * @param {string} [context.minimumVersion]
 * @param {string|null} [context.expectedVersion] - Version the leased sidecar image was verified at.
 * @returns {{version: string, memory: object|null}}
 */
export const assertSupportedFormalAiBackend = (probe, { baseUrl, minimumVersion = FORMAL_AI_MINIMUM_VERSION, expectedVersion = null } = {}) => {
  const where = `the Formal AI endpoint ${baseUrl}`;
  if (!probe?.ok) {
    const detail = probe?.error ? `: ${probe.error}` : '';
    if (probe?.kind === 'unauthorized') throw new Error(`${where} refused the configured credentials${detail}. Set FORMAL_AI_API_KEY to a key the server accepts.`);
    if (probe?.kind === 'malformed') throw new Error(`${where} answered ${FORMAL_AI_HEALTH_PATH} with something other than JSON${detail}. Hive Mind will not guess which Formal AI release is serving this task.`);
    if (probe?.kind === 'no-version') throw new Error(`${where} answered ${FORMAL_AI_HEALTH_PATH} without a version${detail}. Hive Mind requires a serving backend that reports its version (Formal AI >= ${minimumVersion}).`);
    if (probe?.kind === 'http-error') throw new Error(`${where} did not serve ${FORMAL_AI_HEALTH_PATH}${detail}. Check that HIVE_MIND_FORMAL_AI_BASE_URL points at a Formal AI server >= ${minimumVersion}.`);
    throw new Error(`${where} could not be reached${detail}. Check HIVE_MIND_FORMAL_AI_BASE_URL and that the Formal AI server is running.`);
  }
  if (!isFormalAiVersionAtLeast(probe.version, minimumVersion)) {
    throw new Error(`${where} serves Formal AI ${probe.version}, but Hive Mind requires >= ${minimumVersion}. Upgrade the server; the local wrapper's version does not change what answers the requests.`);
  }
  if (probe.memory?.compatible === false) {
    throw new Error(`${where} reports incompatible persisted memory (migration_state=${probe.memory?.migration_state ?? 'unknown'}). Refusing to run a task against memory the serving release cannot read.`);
  }
  if (expectedVersion && expectedVersion !== probe.version) {
    // A lease pins the sidecar's image for the whole task, so the endpoint
    // answering with a different release means it is not the container Hive
    // Mind verified and leased.
    throw new Error(`${where} serves Formal AI ${probe.version}, but the leased Hive Mind sidecar image was verified as ${expectedVersion}. Refusing to record provenance for a backend that is not the accepted release.`);
  }
  return { version: probe.version, memory: probe.memory ?? null };
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

/**
 * The provenance Hive Mind's sidecar lifecycle publishes for the container it
 * leased to this task (issues #2207, #2208).
 *
 * The lease pins one verified image for the whole task, so these values say
 * which release *should* be answering. They are a cross-check, never a
 * substitute for asking the endpoint itself.
 */
export const readFormalAiSidecarProvenance = (env = process.env) => {
  const read = name => String(env[name] || '').trim() || null;
  const image = read(FORMAL_AI_SIDECAR_PROVENANCE_ENV.image);
  const imageDigest = read(FORMAL_AI_SIDECAR_PROVENANCE_ENV.imageDigest);
  const version = read(FORMAL_AI_SIDECAR_PROVENANCE_ENV.version);
  const imageSource = read(FORMAL_AI_SIDECAR_PROVENANCE_ENV.imageSource);
  if (!image && !imageDigest && !version) return null;
  return { image, imageDigest, version, imageSource };
};

/**
 * Publish the leased sidecar's identity into a task's environment so the runtime
 * inside the container can cross-check the endpoint it is pointed at.
 *
 * @param {object|null} sidecar - An `acquireFormalAiSidecar` result.
 * @returns {object} Environment entries (empty when nothing is known).
 */
export const buildFormalAiSidecarProvenanceEnv = (sidecar = null) => {
  if (!sidecar) return {};
  const entries = {
    [FORMAL_AI_SIDECAR_PROVENANCE_ENV.image]: sidecar.imageReference || sidecar.image || null,
    [FORMAL_AI_SIDECAR_PROVENANCE_ENV.imageDigest]: sidecar.imageDigest || null,
    [FORMAL_AI_SIDECAR_PROVENANCE_ENV.version]: sidecar.servingVersion || sidecar.health?.version || null,
    [FORMAL_AI_SIDECAR_PROVENANCE_ENV.imageSource]: sidecar.imageSource || null,
  };
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
};

/** One-line description of the backend for logs and session provenance. */
const describeFormalAiBackend = backend => [`${backend.version} at ${backend.baseUrl}`, backend.image ? `image ${backend.image}` : null, backend.imageDigest ? `digest ${backend.imageDigest}` : null].filter(Boolean).join(', ');

/**
 * Query the endpoint that will serve this task and build its provenance record.
 *
 * @returns {Promise<object>} `{ baseUrl, version, memory, image, imageDigest, imageSource, managed, probedAt }`
 */
const resolveFormalAiBackend = async ({ baseUrl, apiKey, env, deps, managed }) => {
  const sidecar = readFormalAiSidecarProvenance(env);
  const probe = await (deps.probeBackendImpl || probeFormalAiBackend)({ baseUrl, apiKey, env });
  const { version, memory } = assertSupportedFormalAiBackend(probe, { baseUrl, expectedVersion: sidecar?.version ?? null });
  return {
    baseUrl,
    version,
    memory,
    image: sidecar?.image ?? null,
    imageDigest: sidecar?.imageDigest ?? null,
    imageSource: sidecar?.imageSource ?? null,
    managed: !!sidecar,
    local: managed,
    probedAt: new Date().toISOString(),
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
  if (cached) {
    // Issue #2208: the cache key is the endpoint, not the release behind it. An
    // external base URL can be re-pointed at a different container between
    // tasks, so the cached provenance is re-checked instead of replayed.
    const backend = await resolveFormalAiBackend({ baseUrl: cached.runtime.baseUrl, apiKey: resolveFormalAiApiKey(env), env, deps, managed: cached.runtime.serverStarted });
    if (backend.version !== cached.runtime.backend?.version || backend.imageDigest !== cached.runtime.backend?.imageDigest) {
      await log(`🧠 Formal AI: serving backend changed to ${describeFormalAiBackend(backend)}`);
    }
    cached.runtime.backend = backend;
    cached.runtime.formalAiVersion = backend.version;
    return cached.runtime;
  }

  installExitHook();

  // Issue #2146: `--no-tool-check` skipped the only version probe, allowing an
  // old Formal AI build to return the same unexecuted plan through all five
  // Claude/Codex restarts. Runtime safety cannot depend on preflight options.
  //
  // This is the *local wrapper*: the executable that starts the server and
  // writes the client configuration. Issue #2208: it is not necessarily the
  // release that answers the model requests, so it keeps its own name and its
  // own compatibility check, and it is never reported as the serving version.
  const formalAiWrapperVersion = await (deps.readVersionImpl || readFormalAiBinaryVersion)({ formalAiPath: resolvedFormalAiPath, env });
  assertSupportedFormalAiVersion(formalAiWrapperVersion);
  await log(`🧠 Formal AI: local wrapper version ${formalAiWrapperVersion} (minimum ${FORMAL_AI_MINIMUM_VERSION})`);

  const apiKey = resolveFormalAiApiKey(env);
  const externalBaseUrl = env.HIVE_MIND_FORMAL_AI_BASE_URL?.trim() || null;
  const homeRoot = resolveFormalAiHomeRoot(env);
  await mkdir(homeRoot, { recursive: true }).catch(() => {});
  const home = await (deps.mkdtempImpl || mkdtemp)(join(homeRoot, `${tool}-`));

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

    // Before any client configuration is written, ask the endpoint who it is.
    const backend = await resolveFormalAiBackend({ baseUrl, apiKey, env, deps, managed: !!server });
    await log(`🧠 Formal AI: serving backend ${describeFormalAiBackend(backend)}`);
    if (backend.version !== formalAiWrapperVersion) {
      await log(`🧠 Formal AI: local wrapper ${formalAiWrapperVersion} differs from the serving backend ${backend.version}; provenance records the backend`, { verbose: true });
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
      /** The release that actually answers this task's model requests. */
      formalAiVersion: backend.version,
      /** The local executable that started the server and wrote the config. */
      formalAiWrapperVersion,
      backend,
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
