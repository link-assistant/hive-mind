#!/usr/bin/env node

/**
 * Regression coverage for issue #2130 — `--model formal-ai` on a hello-world task.
 *
 * The three failing runs quoted in the issue all died inside the
 * `formal-ai with <tool> <args...>` argv wrapper, so Hive Mind now runs the
 * native CLI against a local Formal AI server instead. These tests pin the
 * pieces of that runtime that are pure enough to check without a real
 * `formal-ai` binary, plus the stream-parsing false negative the same runs
 * exposed in the Agent CLI adapter.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFormalAiClientEnv, buildGeminiAuthSettings, buildQwenAuthEnv, findFormalAiClient, loadFormalAiClientRegistry, parseShellEnvExports, prepareFormalAiRuntime, resetFormalAiRuntimeCache, resolveFormalAiApiKey, resolveFormalAiHomeRoot, seedFormalAiClientHome, waitForFormalAiServerReady } from '../src/formal-ai-runtime.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const withTempDir = async body => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-2130-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// --- shell_env parsing (claude, gemini, qwen) -------------------------------

test('parseShellEnvExports reads the export lines Formal AI writes into .profile', () => {
  const parsed = parseShellEnvExports(['# Formal AI', '', 'export ANTHROPIC_BASE_URL="http://127.0.0.1:41235/api/anthropic"', "export ANTHROPIC_MODEL='formal-ai'", 'export ANTHROPIC_AUTH_TOKEN="${FORMAL_AI_API_KEY:-formal-ai}"', 'export ANTHROPIC_API_KEY=${FORMAL_AI_API_KEY}', 'not an export line', '# export COMMENTED_OUT="nope"'].join('\n'), { apiKey: 'secret-key' });

  assert.deepEqual(parsed, {
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:41235/api/anthropic',
    ANTHROPIC_MODEL: 'formal-ai',
    ANTHROPIC_AUTH_TOKEN: 'secret-key',
    ANTHROPIC_API_KEY: 'secret-key',
  });
});

test('parseShellEnvExports falls back to the placeholder default when no key is configured', () => {
  const parsed = parseShellEnvExports('export ANTHROPIC_AUTH_TOKEN="${FORMAL_AI_API_KEY:-formal-ai}"', { apiKey: '' });
  assert.equal(parsed.ANTHROPIC_AUTH_TOKEN, 'formal-ai');
});

test('resolveFormalAiApiKey prefers the operator key and defaults otherwise', () => {
  assert.equal(resolveFormalAiApiKey({ FORMAL_AI_API_KEY: '  from-env  ' }), 'from-env');
  assert.equal(resolveFormalAiApiKey({}), 'formal-ai');
});

// --- per-format environment construction -----------------------------------

test('buildFormalAiClientEnv turns a shell_env config into exported variables', async () =>
  withTempDir(async home => {
    await writeFile(join(home, '.profile'), 'export ANTHROPIC_BASE_URL="http://127.0.0.1:5000/api/anthropic"\nexport ANTHROPIC_MODEL="formal-ai"\n');
    const { env, notes } = await buildFormalAiClientEnv({
      client: { id: 'claude', api_key_env: 'ANTHROPIC_API_KEY', global_configs: [{ format: 'shell_env', path: '.profile' }] },
      home,
      apiKey: 'k',
    });

    assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:5000/api/anthropic');
    assert.equal(env.ANTHROPIC_MODEL, 'formal-ai');
    assert.equal(env.ANTHROPIC_API_KEY, 'k', 'the declared api_key_env is filled in when the profile does not set it');
    assert.equal(env.FORMAL_AI_API_KEY, 'k');
    assert.deepEqual(notes, ['shell_env:.profile']);
  }));

test('buildFormalAiClientEnv points codex at CODEX_HOME instead of copying its TOML', async () =>
  withTempDir(async home => {
    const { env } = await buildFormalAiClientEnv({
      client: { id: 'codex', global_configs: [{ format: 'toml', path: '.codex/config.toml' }] },
      home,
      apiKey: 'k',
    });

    // Codex resolves its provider block *and* its model catalog relative to
    // CODEX_HOME. Passing `-c` overrides instead is not equivalent: codex-cli
    // 0.146.0 lets `-c` after `exec` replace the globals given before it.
    assert.equal(env.CODEX_HOME, join(home, '.codex'));
  }));

test('buildFormalAiClientEnv points agent/opencode at XDG_CONFIG_HOME', async () =>
  withTempDir(async home => {
    const { env } = await buildFormalAiClientEnv({
      client: { id: 'agent', global_configs: [{ format: 'json', path: '.config/link-assistant-agent/opencode.json' }] },
      home,
      apiKey: 'k',
    });

    assert.equal(env.XDG_CONFIG_HOME, join(home, '.config'));
  }));

test('buildFormalAiClientEnv records an unsupported config format instead of failing silently', async () =>
  withTempDir(async home => {
    const { notes } = await buildFormalAiClientEnv({
      client: { id: 'exotic', global_configs: [{ format: 'yaml', path: '.exotic/config.yaml' }] },
      home,
      apiKey: 'k',
    });

    assert.deepEqual(notes, ['unsupported:yaml:.exotic/config.yaml']);
  }));

test('buildFormalAiClientEnv tolerates a shell_env config Formal AI has not written yet', async () =>
  withTempDir(async home => {
    const { env, notes } = await buildFormalAiClientEnv({
      client: { id: 'qwen', global_configs: [{ format: 'shell_env', path: '.profile' }] },
      home,
      apiKey: 'k',
    });

    assert.deepEqual(notes, []);
    assert.deepEqual(env, { FORMAL_AI_API_KEY: 'k' });
  }));

// --- seeding the isolated HOME ---------------------------------------------

test('seedFormalAiClientHome copies directory-based configuration and skips shell_env', async () => {
  const calls = [];
  const seeded = await seedFormalAiClientHome({
    client: {
      id: 'agent',
      global_configs: [
        { format: 'json', path: '.config/link-assistant-agent/opencode.json' },
        // `.profile` is a shell startup file: importing the operator's exports
        // would leak unrelated environment into the CLI we launch.
        { format: 'shell_env', path: '.profile' },
      ],
    },
    home: '/tmp/isolated-home',
    realHome: '/home/operator',
    env: {},
    cpImpl: async (source, destination, options) => void calls.push({ source, destination, options }),
  });

  assert.deepEqual(calls, [
    {
      source: '/home/operator/.config/link-assistant-agent',
      destination: '/tmp/isolated-home/.config/link-assistant-agent',
      options: { recursive: true, verbatimSymlinks: true, force: true },
    },
  ]);
  assert.deepEqual(seeded, ['/home/operator/.config/link-assistant-agent → .config/link-assistant-agent']);
});

test('seedFormalAiClientHome seeds codex from the repository-scoped CODEX_HOME (issue #2074)', async () => {
  const calls = [];
  await seedFormalAiClientHome({
    client: { id: 'codex', global_configs: [{ format: 'toml', path: '.codex/config.toml' }] },
    home: '/tmp/isolated-home',
    realHome: '/home/operator',
    env: { CODEX_HOME: '/tmp/hive-codex-home-abc' },
    cpImpl: async (source, destination) => void calls.push({ source, destination }),
  });

  assert.deepEqual(calls, [{ source: '/tmp/hive-codex-home-abc', destination: '/tmp/isolated-home/.codex' }]);
});

test('seedFormalAiClientHome ignores a tool that has never been configured', async () => {
  const seeded = await seedFormalAiClientHome({
    client: { id: 'agent', global_configs: [{ format: 'json', path: '.config/link-assistant-agent/opencode.json' }] },
    home: '/tmp/isolated-home',
    realHome: '/home/operator',
    env: {},
    cpImpl: async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  });

  assert.deepEqual(seeded, [], 'a missing source directory is not an error — Formal AI writes a fresh config');
});

// --- gemini headless auth ---------------------------------------------------

test('buildGeminiAuthSettings selects the API-key auth headless runs require', () => {
  assert.deepEqual(buildGeminiAuthSettings(), { security: { auth: { selectedType: 'gemini-api-key' } } });
});

// --- qwen headless auth -----------------------------------------------------

test('buildQwenAuthEnv completes the triple Qwen Code needs to detect OpenAI auth', () => {
  // Formal AI's `.profile` block writes only the key and the base URL, so
  // `getAuthTypeFromEnv` returns undefined and the run aborts with
  // "No auth type is selected".
  assert.deepEqual(buildQwenAuthEnv({ OPENAI_API_KEY: 'formal-ai', OPENAI_BASE_URL: 'http://127.0.0.1:1/api/openai/v1' }), { OPENAI_MODEL: 'formal-ai' });
});

test('buildQwenAuthEnv never overrides a model the operator already set', () => {
  const base = { OPENAI_API_KEY: 'formal-ai', OPENAI_BASE_URL: 'http://127.0.0.1:1/api/openai/v1' };
  assert.deepEqual(buildQwenAuthEnv({ ...base, OPENAI_MODEL: 'qwen3-coder-plus' }), {});
  assert.deepEqual(buildQwenAuthEnv({ ...base, QWEN_MODEL: 'qwen3-coder-plus' }), {});
});

test('buildQwenAuthEnv stays out of the way when the OpenAI protocol is not in play', () => {
  assert.deepEqual(buildQwenAuthEnv({}), {});
  assert.deepEqual(buildQwenAuthEnv({ OPENAI_API_KEY: 'formal-ai' }), {});
  assert.deepEqual(buildQwenAuthEnv({ OPENAI_BASE_URL: 'http://127.0.0.1:1/api/openai/v1' }), {});
});

// --- client registry --------------------------------------------------------

test('loadFormalAiClientRegistry accepts both the array and the wrapped registry shape', async () => {
  const asArray = await loadFormalAiClientRegistry({ run: async () => ({ stdout: '[{"id":"claude"}]' }) });
  assert.deepEqual(asArray, [{ id: 'claude' }]);

  const wrapped = await loadFormalAiClientRegistry({ run: async () => ({ stdout: '{"clients":[{"id":"codex"}]}' }) });
  assert.deepEqual(wrapped, [{ id: 'codex' }]);
});

test('findFormalAiClient matches ids and aliases', () => {
  const clients = [{ id: 'agent', aliases: ['link-assistant-agent'] }, { id: 'claude' }];
  assert.equal(findFormalAiClient(clients, 'agent')?.id, 'agent');
  assert.equal(findFormalAiClient(clients, 'link-assistant-agent')?.id, 'agent');
  assert.equal(findFormalAiClient(clients, 'nope'), null);
});

// --- readiness probing ------------------------------------------------------

test('waitForFormalAiServerReady stops as soon as the server answers', async () => {
  const urls = [];
  const result = await waitForFormalAiServerReady({
    baseUrl: 'http://127.0.0.1:1234',
    intervalMs: 1,
    fetchImpl: async url => {
      urls.push(url);
      return { ok: urls.length >= 2, status: 503 };
    },
  });

  assert.deepEqual(result, { ready: true, error: null });
  assert.deepEqual(urls, ['http://127.0.0.1:1234/api/openai/v1/models', 'http://127.0.0.1:1234/api/openai/v1/models']);
});

test('waitForFormalAiServerReady gives up immediately when the server process died', async () => {
  const result = await waitForFormalAiServerReady({
    baseUrl: 'http://127.0.0.1:1234',
    intervalMs: 1,
    isAlive: () => false,
    fetchImpl: async () => assert.fail('a dead server must not be probed'),
  });

  assert.equal(result.ready, false);
  assert.match(result.error, /exited before it became ready/);
});

test('waitForFormalAiServerReady reports the last transport error after the deadline', async () => {
  const result = await waitForFormalAiServerReady({
    baseUrl: 'http://127.0.0.1:1234',
    intervalMs: 1,
    timeoutMs: 5,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.error, 'ECONNREFUSED');
});

// --- end-to-end runtime preparation (all seams injected) --------------------

const registryFor = tool =>
  ({
    claude: { id: 'claude', api_key_env: 'ANTHROPIC_API_KEY', default_protocol: 'anthropic', endpoints: { anthropic: '/api/anthropic' }, global_configs: [{ format: 'shell_env', path: '.profile' }] },
    gemini: { id: 'gemini', api_key_env: 'GEMINI_API_KEY', default_protocol: 'gemini', endpoints: { gemini: '/api/gemini' }, global_configs: [{ format: 'shell_env', path: '.profile' }] },
    codex: { id: 'codex', default_protocol: 'openai', endpoints: { openai: '/api/openai/v1' }, global_configs: [{ format: 'toml', path: '.codex/config.toml' }] },
    qwen: { id: 'qwen', api_key_env: 'OPENAI_API_KEY', default_protocol: 'openai', endpoints: { openai: '/api/openai/v1' }, global_configs: [{ format: 'shell_env', path: '.profile' }] },
  })[tool];

const prepareWithStubs = async ({ tool, env = {}, profile = null }) => {
  resetFormalAiRuntimeCache();
  const home = await mkdtemp(join(tmpdir(), 'hive-2130-runtime-'));
  const stopped = [];
  const runtime = await prepareFormalAiRuntime({
    tool,
    workdir: '/tmp/workspace',
    env,
    formalAiPath: '/opt/formal-ai',
    deps: {
      readVersionImpl: async () => '0.333.2',
      mkdtempImpl: async () => home,
      startServerImpl: async options => {
        stopped.push({ started: options });
        return { baseUrl: 'http://127.0.0.1:41235', port: 41235, pid: 4242, stop: async () => stopped.push({ stopped: true }) };
      },
      loadRegistryImpl: async () => [registryFor(tool)],
      seedImpl: async () => [],
      configureImpl: async () => {
        if (profile) await writeFile(join(home, '.profile'), profile);
      },
    },
  });
  return { runtime, home, stopped };
};

test('prepareFormalAiRuntime starts the server in the repository clone and returns the tool environment', async () => {
  const { runtime, stopped } = await prepareWithStubs({
    tool: 'claude',
    profile: 'export ANTHROPIC_BASE_URL="http://127.0.0.1:41235/api/anthropic"\nexport ANTHROPIC_MODEL="formal-ai"\n',
  });

  try {
    // Formal AI absolutises tool-call paths against the *server's* working
    // directory, so a server started elsewhere writes files outside the clone.
    assert.equal(stopped[0].started.cwd, '/tmp/workspace');
    assert.equal(runtime.baseUrl, 'http://127.0.0.1:41235');
    assert.equal(runtime.serverStarted, true);
    assert.equal(runtime.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:41235/api/anthropic');
    assert.equal(runtime.env.ANTHROPIC_API_KEY, 'formal-ai');
    assert.ok(!('HOME' in runtime.env), 'HOME stays untouched so git/gh configuration remains visible to the tool');
  } finally {
    await runtime.stop();
    resetFormalAiRuntimeCache();
  }
});

test('prepareFormalAiRuntime reuses one server per workspace and tool', async () => {
  const { runtime, stopped } = await prepareWithStubs({ tool: 'claude', profile: 'export ANTHROPIC_MODEL="formal-ai"\n' });
  try {
    const again = await prepareFormalAiRuntime({ tool: 'claude', workdir: '/tmp/workspace', env: {}, formalAiPath: '/opt/formal-ai', deps: { startServerImpl: async () => assert.fail('a second server must not be started') } });
    assert.equal(again, runtime);
    assert.equal(stopped.filter(entry => entry.started).length, 1);
  } finally {
    await runtime.stop();
    resetFormalAiRuntimeCache();
  }
});

test('prepareFormalAiRuntime injects the gemini auth settings through the system-settings scope', async () => {
  const { runtime, home } = await prepareWithStubs({ tool: 'gemini', profile: 'export GOOGLE_GEMINI_BASE_URL="http://127.0.0.1:41235/api/gemini"\n' });

  try {
    assert.equal(runtime.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, join(home, '.gemini', 'settings.json'));
    assert.ok(!('HOME' in runtime.env), 'overriding HOME would hide the operator git/gh/ssh configuration from gemini shell calls');
    const written = JSON.parse(await readFile(join(home, '.gemini', 'settings.json'), 'utf8'));
    assert.deepEqual(written, buildGeminiAuthSettings());
  } finally {
    await runtime.stop();
    resetFormalAiRuntimeCache();
  }
});

test('prepareFormalAiRuntime completes the qwen auth triple from the .profile block', async () => {
  const { runtime } = await prepareWithStubs({ tool: 'qwen', profile: 'export OPENAI_API_KEY="formal-ai"\nexport OPENAI_BASE_URL="http://127.0.0.1:41235/api/openai/v1"\n' });

  try {
    assert.equal(runtime.env.OPENAI_MODEL, 'formal-ai');
    assert.equal(runtime.env.OPENAI_BASE_URL, 'http://127.0.0.1:41235/api/openai/v1');
    assert.ok(
      runtime.notes.some(note => note === 'OPENAI_MODEL=formal-ai'),
      'the injected variable is reported in verbose mode'
    );
  } finally {
    await runtime.stop();
    resetFormalAiRuntimeCache();
  }
});

test('prepareFormalAiRuntime uses a configured persistent endpoint instead of starting a server', async () => {
  const { runtime } = await prepareWithStubs({
    tool: 'codex',
    env: { HIVE_MIND_FORMAL_AI_BASE_URL: 'http://formal-ai:41235' },
  });

  try {
    assert.equal(runtime.baseUrl, 'http://formal-ai:41235');
    assert.equal(runtime.serverStarted, false);
    assert.match(runtime.env.CODEX_HOME, /\.codex$/);
  } finally {
    await runtime.stop();
    resetFormalAiRuntimeCache();
  }
});

test('prepareFormalAiRuntime rejects a stale binary before starting a server', async () => {
  resetFormalAiRuntimeCache();
  let serverStarted = false;
  await assert.rejects(
    prepareFormalAiRuntime({
      tool: 'claude',
      workdir: '/tmp/stale-formal-ai-workspace',
      env: {},
      formalAiPath: '/opt/formal-ai',
      deps: {
        readVersionImpl: async () => '0.326.0',
        startServerImpl: async () => {
          serverStarted = true;
          return { baseUrl: 'http://127.0.0.1:41235', pid: 4242, stop: async () => {} };
        },
      },
    }),
    /requires Formal AI >= 0\.333\.2, found 0\.326\.0/
  );
  assert.equal(serverStarted, false, 'the stale binary is rejected before any model endpoint starts');
  resetFormalAiRuntimeCache();
});

test('prepareFormalAiRuntime fails with an actionable message for a tool Formal AI cannot configure', async () => {
  resetFormalAiRuntimeCache();
  await assert.rejects(
    prepareFormalAiRuntime({
      tool: 'nonexistent',
      workdir: '/tmp/workspace',
      env: { HIVE_MIND_FORMAL_AI_BASE_URL: 'http://formal-ai:41235' },
      formalAiPath: '/opt/formal-ai',
      deps: { readVersionImpl: async () => '0.333.2', loadRegistryImpl: async () => [{ id: 'claude' }] },
    }),
    /does not list a client configuration for "nonexistent"/
  );
  resetFormalAiRuntimeCache();
});

// --- Agent CLI stream parsing ----------------------------------------------

test('agent/opencode adapters read the assistant text nested under `part`', async () => {
  // Agent CLI 0.25.x emits {"type":"text","part":{"type":"text","text":"…"}}
  // and never a top-level `data.text`. Reading only `data.text` left
  // `resultSummary` null on every successful run, which Hive Mind reported as
  // "No working session summary available from AI tool output".
  for (const file of ['src/agent.lib.mjs', 'src/opencode.lib.mjs']) {
    const source = await readFile(join(repoRoot, file), 'utf8');
    assert.match(source, /data\.type === 'text' && \(data\.text \|\| data\.part\?\.text\)/, `${file} accepts the nested part.text shape`);
    assert.match(source, /lastTextContent = data\.text \|\| data\.part\.text/, `${file} stores the nested part.text as the result summary`);
  }
});

// --- the argv wrapper must not come back ------------------------------------

test('no tool adapter dispatches through the `formal-ai with` argv wrapper', async () => {
  for (const tool of ['claude', 'codex', 'agent', 'opencode', 'qwen', 'gemini']) {
    const source = await readFile(join(repoRoot, 'src', `${tool}.lib.mjs`), 'utf8');
    const code = source
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    assert.ok(!/formal-ai\s+with/.test(code), `${tool}.lib.mjs must not rebuild the argv wrapper (issue #2130)`);
    assert.ok(source.includes('resolveFormalAiToolExecution'), `${tool}.lib.mjs dispatches through formal-ai.lib.mjs`);
  }
});

test('the isolated HOME is only ever used to hold Formal AI configuration', async () => {
  const source = await readFile(join(repoRoot, 'src', 'formal-ai-runtime.lib.mjs'), 'utf8');
  // `formal-ai with --global` needs HOME to land in the isolated directory, but
  // the environment handed to the CLI must not carry it.
  assert.match(source, /env: \{ \.\.\.process\.env, \.\.\.env, HOME: home \}/, 'configuration is written with an isolated HOME');
  assert.ok(!/clientEnv\.HOME\s*=/.test(source), 'the CLI environment never overrides HOME');
});

// --- the isolated HOME must live outside /tmp -------------------------------

test('resolveFormalAiHomeRoot keeps the throwaway HOME out of the system temp dir', () => {
  // codex-cli 0.146.0 refuses to create its PATH helper binaries when CODEX_HOME
  // is under the temp dir and prints a WARNING on every single run.
  const root = resolveFormalAiHomeRoot({}, '/home/operator');
  assert.equal(root, join('/home/operator', '.cache', 'hive-mind', 'formal-ai'));
  assert.ok(!root.startsWith(tmpdir() + '/'), 'the root is not under the system temp dir');
});

test('resolveFormalAiHomeRoot honours HIVE_MIND_FORMAL_AI_HOME_ROOT', () => {
  assert.equal(resolveFormalAiHomeRoot({ HIVE_MIND_FORMAL_AI_HOME_ROOT: '  /srv/formal-ai-homes  ' }, '/home/operator'), '/srv/formal-ai-homes');
});

test('prepareFormalAiRuntime creates the isolated HOME under the configured root', async () => {
  resetFormalAiRuntimeCache();
  await withTempDir(async dir => {
    const home = join(dir, 'home');
    const prefixes = [];
    const runtime = await prepareFormalAiRuntime({
      tool: 'codex',
      workdir: '/tmp/workspace',
      env: { HIVE_MIND_FORMAL_AI_HOME_ROOT: dir },
      formalAiPath: '/opt/formal-ai',
      deps: {
        readVersionImpl: async () => '0.333.2',
        mkdtempImpl: async prefix => {
          prefixes.push(prefix);
          return home;
        },
        startServerImpl: async () => ({ baseUrl: 'http://127.0.0.1:41235', port: 41235, pid: 4242, stop: async () => {} }),
        loadRegistryImpl: async () => [registryFor('codex')],
        seedImpl: async () => [],
        configureImpl: async () => {},
      },
    });

    try {
      assert.deepEqual(prefixes, [join(dir, 'codex-')]);
      assert.equal(runtime.home, home);
    } finally {
      await runtime.stop();
      resetFormalAiRuntimeCache();
    }
  });
});
