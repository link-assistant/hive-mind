#!/usr/bin/env node

/**
 * Regression coverage for issue #2059.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { executeAgentCommand } from '../src/agent.lib.mjs';
import { executeClaudeCommand } from '../src/claude.lib.mjs';
import { executeCodexCommand } from '../src/codex.lib.mjs';
import { executeGeminiCommand } from '../src/gemini.lib.mjs';
import { buildDockerIsolationStartArgs, resolveFormalAiIsolationEnv } from '../src/isolation-runner.lib.mjs';
import { getValidModelsForTool, isModelCompatibleWithTool, mapModelForTool, primaryModelNames, validateModelName } from '../src/models/index.mjs';
import { parseFormalAiVersion, readFormalAiVersion, resolveFormalAiToolExecution, validateFormalAiToolConnection } from '../src/formal-ai.lib.mjs';
import { executeOpenCodeCommand } from '../src/opencode.lib.mjs';
import { executeQwenCommand } from '../src/qwen.lib.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const FORMAL_AI_MODEL_BY_TOOL = {
  claude: 'formal-ai',
  agent: 'formalai/formal-ai',
  opencode: 'formalai/formal-ai',
  codex: 'formal-ai',
  qwen: 'formal-ai',
  gemini: 'formal-ai',
};

for (const [tool, expectedModel] of Object.entries(FORMAL_AI_MODEL_BY_TOOL)) {
  test(`--tool ${tool} accepts and maps --model formal-ai`, () => {
    const validation = validateModelName('formal-ai', tool);

    assert.equal(validation.valid, true);
    assert.equal(validation.mappedModel, expectedModel);
    assert.equal(mapModelForTool(tool, 'formal-ai'), expectedModel);
    assert.equal(isModelCompatibleWithTool(tool, 'formal-ai'), true);
    assert.ok(getValidModelsForTool(tool).includes('formal-ai'));
    assert.ok(primaryModelNames[tool].includes('formal-ai'));
  });

  test(`--tool ${tool} accepts the full formalai/formal-ai selector`, () => {
    const validation = validateModelName('formalai/formal-ai', tool);

    assert.equal(validation.valid, true);
    assert.equal(validation.mappedModel, expectedModel);
    assert.equal(mapModelForTool(tool, 'formalai/formal-ai'), expectedModel);
    assert.equal(isModelCompatibleWithTool(tool, 'formalai/formal-ai'), true);
  });

  // Issue #2130: dispatch runs the native CLI against a Formal AI endpoint instead
  // of wrapping the argument list in `formal-ai with`, which swallowed the prompt.
  test(`--tool ${tool} runs the native CLI against the Formal AI endpoint`, async () => {
    const invocation = await resolveFormalAiToolExecution({
      tool,
      model: 'formal-ai',
      toolPath: `/opt/hive/${tool}`,
      workdir: '/tmp/issue-2059',
      env: {},
      deps: {
        prepareRuntimeImpl: async ({ tool: preparedTool, workdir }) => ({
          baseUrl: 'http://127.0.0.1:45678',
          home: `/tmp/home-${preparedTool}`,
          env: { FORMAL_AI_API_KEY: 'formal-ai', WORKDIR: workdir },
          client: { id: preparedTool },
          stop: async () => {},
        }),
      },
    });

    assert.equal(invocation.command, `/opt/hive/${tool}`);
    assert.deepEqual(invocation.args, []);
    assert.equal(invocation.displayCommand, `/opt/hive/${tool}`);
    assert.equal(invocation.formalAi, true);
    assert.equal(invocation.baseUrl, 'http://127.0.0.1:45678');
    assert.equal(invocation.env.FORMAL_AI_API_KEY, 'formal-ai');
  });
}

test('a non-Formal-AI model keeps its configured tool command', async () => {
  const invocation = await resolveFormalAiToolExecution({
    tool: 'agent',
    model: 'nemotron-3-super-free',
    toolPath: '/opt/hive/agent',
    env: {},
    deps: {
      prepareRuntimeImpl: async () => {
        throw new Error('a non-Formal-AI model must not prepare a Formal AI runtime');
      },
    },
  });

  assert.equal(invocation.command, '/opt/hive/agent');
  assert.deepEqual(invocation.args, []);
  assert.equal(invocation.displayCommand, '/opt/hive/agent');
  assert.equal(invocation.formalAi, false);
});

test('a configured persistent server is used instead of a run-owned temporary server', async () => {
  const prepared = [];
  const invocation = await resolveFormalAiToolExecution({
    tool: 'codex',
    model: 'formal-ai',
    toolPath: 'codex',
    workdir: '/tmp/issue-2059',
    env: {
      HIVE_MIND_FORMAL_AI_PATH: '/opt/formal ai/formal-ai',
      HIVE_MIND_FORMAL_AI_BASE_URL: 'http://link-assistant-formal-ai:8080',
    },
    deps: {
      prepareRuntimeImpl: async options => {
        prepared.push(options);
        return { baseUrl: options.env.HIVE_MIND_FORMAL_AI_BASE_URL, env: {}, home: '/tmp/home', client: { id: 'codex' }, stop: async () => {} };
      },
    },
  });

  assert.equal(invocation.command, 'codex');
  assert.equal(invocation.baseUrl, 'http://link-assistant-formal-ai:8080');
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].env.HIVE_MIND_FORMAL_AI_PATH, '/opt/formal ai/formal-ai');
});

test('an invalid persistent endpoint fails fast with an actionable message', async () => {
  await assert.rejects(
    resolveFormalAiToolExecution({
      tool: 'codex',
      model: 'formal-ai',
      toolPath: 'codex',
      workdir: '/tmp/issue-2059',
      env: { HIVE_MIND_FORMAL_AI_BASE_URL: 'not-a-url' },
    }),
    /HIVE_MIND_FORMAL_AI_BASE_URL must be a valid HTTP\(S\) URL/
  );
});

test('prepare-only dispatch never starts a server or writes tool configuration', async () => {
  const invocation = await resolveFormalAiToolExecution({
    tool: 'claude',
    model: 'formal-ai',
    toolPath: 'claude',
    workdir: '/tmp/issue-2059',
    prepareOnly: true,
    env: {},
    deps: {
      prepareRuntimeImpl: async () => {
        throw new Error('--only-prepare-command / --dry-run must not start a Formal AI server');
      },
    },
  });

  assert.equal(invocation.command, 'claude');
  assert.equal(invocation.formalAi, true);
  assert.equal(invocation.prepared, true);
});

test('--tool agent --model formal-ai --only-prepare-command reaches command preparation without execution', async () => {
  const logLines = [];
  const result = await executeAgentCommand({
    tempDir: process.cwd(),
    branchName: 'issue-2059-test',
    prompt: 'Solve issue 2059',
    systemPrompt: '',
    argv: {
      model: 'formal-ai',
      onlyPrepareCommand: true,
      verbose: false,
    },
    log: async line => logLines.push(String(line)),
    formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    agentPath: 'agent',
    $: () => {
      throw new Error('The Agent CLI must not execute in prepare-only mode');
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.preparedOnly, true);
  assert.match(result.preparedCommand, /agent --model formalai\/formal-ai/);
  assert.ok(!result.preparedCommand.includes('formal-ai with'), 'the argv wrapper must not be used any more (issue #2130)');
  assert.ok(logLines.some(line => line.includes('AI execution skipped')));
});

const preparedCommandParams = (tempDir, toolPathKey, toolPath) => ({
  tempDir,
  workspaceTmpDir: tempDir,
  branchName: 'issue-2059-test',
  prompt: 'Solve issue 2059',
  systemPrompt: '',
  escapedSystemPrompt: '',
  argv: {
    model: 'formal-ai',
    onlyPrepareCommand: true,
    verbose: false,
    uselessToolsDisabled: false,
    playwrightMcp: true,
  },
  log: async () => {},
  setLogFile: () => {},
  getLogFile: () => null,
  formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
  getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
  forkedRepo: null,
  feedbackLines: [],
  [toolPathKey]: toolPath,
  $: () => {
    throw new Error('The native CLI must not execute in prepare-only mode');
  },
  owner: null,
  repo: null,
  prNumber: null,
  issueNumber: null,
});

for (const [tool, execute, pathKey] of [
  ['claude', executeClaudeCommand, 'claudePath'],
  ['opencode', executeOpenCodeCommand, 'opencodePath'],
  ['codex', executeCodexCommand, 'codexPath'],
  ['qwen', executeQwenCommand, 'qwenPath'],
  ['gemini', executeGeminiCommand, 'geminiPath'],
]) {
  test(`--tool ${tool} prepares the native executor command without execution`, async () => {
    const tempDir = await mkdtemp(join(tmpdir(), `issue-2059-${tool}-`));
    const previousHome = process.env.HOME;
    if (tool === 'claude') process.env.HOME = tempDir;

    try {
      const result = await execute(preparedCommandParams(tempDir, pathKey, tool));

      assert.equal(result.success, true);
      assert.equal(result.preparedOnly, true);
      assert.match(result.preparedCommand, new RegExp(`(^|[|&(\\s])${tool}\\s`), 'the native CLI is invoked directly (issue #2130)');
      assert.ok(!result.preparedCommand.includes('formal-ai with'), 'the argv wrapper must not be used any more (issue #2130)');
      assert.match(result.preparedCommand, new RegExp(`["']?--model["']? ["']?${FORMAL_AI_MODEL_BY_TOOL[tool]}["']?`));
    } finally {
      if (tool === 'claude') {
        if (previousHome === undefined) delete process.env.HOME;
        else process.env.HOME = previousHome;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
}

test('Formal AI connection validation checks the client registry and selected CLI without starting a server', async () => {
  const calls = [];
  const result = await validateFormalAiToolConnection('qwen', {
    env: { HIVE_MIND_FORMAL_AI_PATH: '/opt/formal-ai' },
    run: async (command, args) => {
      calls.push({ command, args });
      if (command === '/opt/formal-ai' && args[0] === '--version') return { stdout: 'formal-ai 0.336.0\n' };
      if (command === '/opt/formal-ai') return { stdout: JSON.stringify([{ id: 'qwen', default_protocol: 'openai', global_configs: [] }]) };
      return { stdout: 'qwen 1.2.3\n' };
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.version, 'qwen 1.2.3');
  assert.equal(result.formalAiVersion, '0.336.0');
  assert.equal(result.client, 'qwen');
  assert.equal(result.protocol, 'openai');
  assert.deepEqual(calls, [
    { command: '/opt/formal-ai', args: ['--version'] },
    { command: '/opt/formal-ai', args: ['clients', '--format', 'json'] },
    { command: 'qwen', args: ['--version'] },
  ]);
});

test('Formal AI connection validation reports a tool Formal AI cannot configure', async () => {
  const result = await validateFormalAiToolConnection('qwen', {
    env: {},
    run: async (command, args) => {
      if (args[0] === '--version') return { stdout: 'formal-ai 0.336.0\n' };
      return { stdout: JSON.stringify([{ id: 'claude' }, { id: 'codex' }]) };
    },
  });

  assert.equal(result.valid, false);
  assert.match(result.error, /does not list a client configuration for "qwen"/);
  assert.match(result.error, /claude, codex/);
  // Issue #2130: the wrapper version has to survive onto the failure path too,
  // because that is the path whose logs get attached to the pull request.
  assert.equal(result.formalAiVersion, '0.336.0');
});

test('Formal AI wrapper version is parsed from the --version line and reported on every result path', async () => {
  assert.equal(parseFormalAiVersion('formal-ai 0.317.0\n'), '0.317.0');
  assert.equal(parseFormalAiVersion('  formal-ai 0.317.0  '), '0.317.0');
  assert.equal(parseFormalAiVersion('0.317.0'), '0.317.0');
  assert.equal(parseFormalAiVersion(''), null);
  assert.equal(parseFormalAiVersion(null), null);

  assert.equal(await readFormalAiVersion({ env: {}, run: async () => ({ stdout: 'formal-ai 1.0.0' }) }), '1.0.0');
});

test('Formal AI connection validation rejects an unreadable runtime version', async () => {
  // The optional preflight and mandatory runtime preparation use the same
  // support policy; disabling preflight cannot bypass the runtime gate.
  const result = await validateFormalAiToolConnection('qwen', {
    env: {},
    run: async (command, args) => {
      if (args[0] === '--version' && command !== 'qwen') throw new Error('unknown flag: --version');
      if (command === 'qwen') return { stdout: 'qwen 1.2.3' };
      return { stdout: JSON.stringify([{ id: 'qwen', default_protocol: 'openai' }]) };
    },
  });

  assert.equal(result.valid, false);
  assert.equal(result.formalAiVersion, null);
  assert.match(result.error, /could not determine the Formal AI version/i);
  assert.equal(
    await readFormalAiVersion({
      env: {},
      run: async () => {
        throw new Error('ENOENT');
      },
    }),
    null
  );
});

test('Docker-isolated solve jobs receive the configured persistent Formal AI endpoint', () => {
  const args = buildDockerIsolationStartArgs('solve', ['https://example.test/issues/2059'], {
    sessionId: 'issue-2059',
    tool: 'codex',
    env: {
      HIVE_MIND_FORMAL_AI_BASE_URL: 'http://link-assistant-formal-ai:8080',
      HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'konard/hive-mind-dind:test',
    },
    homeDir: '/nonexistent',
    existsSync: () => false,
  });

  const envIndex = args.indexOf('HIVE_MIND_FORMAL_AI_BASE_URL=http://link-assistant-formal-ai:8080');
  assert.ok(envIndex > 0, 'the Formal AI endpoint must be forwarded to the isolated container');
  assert.equal(args[envIndex - 1], '-e');
});

test('nested Docker receives a parent-resolved sidecar address instead of outer-daemon DNS', async () => {
  const env = await resolveFormalAiIsolationEnv(
    {
      HIVE_MIND_FORMAL_AI_BASE_URL: 'http://link-assistant-formal-ai:8080',
      KEEP_ME: 'yes',
    },
    {
      lookup: async hostname => {
        assert.equal(hostname, 'link-assistant-formal-ai');
        return [{ address: '172.30.0.7', family: 4 }];
      },
    }
  );

  assert.equal(env.HIVE_MIND_FORMAL_AI_BASE_URL, 'http://172.30.0.7:8080');
  assert.equal(env.KEEP_ME, 'yes');
});

test('nested Docker preserves arbitrary external Formal AI hostnames', async () => {
  const originalEnv = {
    HIVE_MIND_FORMAL_AI_BASE_URL: 'http://formal-ai.example.test:8080',
  };
  const env = await resolveFormalAiIsolationEnv(originalEnv, {
    lookup: async () => {
      throw new Error('public and custom hostnames must not be resolved by the outer container');
    },
  });

  assert.equal(env, originalEnv);
});

test('Docker assets install the wrapper and define a persistent Formal AI service', async () => {
  const [dockerfile, dindDockerfile, coolifyDockerfile, serverDockerfile, compose, verifyImageScript] = await Promise.all([readFile(join(projectRoot, 'Dockerfile'), 'utf8'), readFile(join(projectRoot, 'Dockerfile.dind'), 'utf8'), readFile(join(projectRoot, 'coolify/Dockerfile'), 'utf8'), readFile(join(projectRoot, 'Dockerfile.formal-ai'), 'utf8'), readFile(join(projectRoot, 'docker-compose.yml'), 'utf8'), readFile(join(projectRoot, 'scripts/verify-docker-image.sh'), 'utf8')]);

  for (const [name, contents] of [
    ['Dockerfile', dockerfile],
    ['Dockerfile.dind', dindDockerfile],
    ['coolify/Dockerfile', coolifyDockerfile],
  ]) {
    assert.match(contents, /FROM rust:1\.96-slim-bookworm AS formal-ai-builder/, `${name} must build against a runtime-compatible glibc`);
    assert.match(contents, /formal-ai --version/, `${name} must verify that the Formal AI wrapper is installed`);
  }

  // Formal AI 0.333.0-0.338.0 pulled native-tls through web-search ->
  // web-capture -> reqwest, so `cargo install formal-ai --locked` needed
  // pkg-config and the OpenSSL headers, which rust:slim does not carry
  // (link-assistant/formal-ai#988, fixed upstream in 0.339.0). The packages
  // stay as defense in depth while the root causes remain open upstream
  // (web-capture#151, browser-commander#77): without them a release that drags
  // openssl-sys back in dies in the Docker job, long after the unit suite is
  // green; with them the build succeeds either way and both are inert when
  // openssl-sys is absent.
  for (const [name, contents] of [
    ['Dockerfile', dockerfile],
    ['Dockerfile.dind', dindDockerfile],
    ['coolify/Dockerfile', coolifyDockerfile],
    ['Dockerfile.formal-ai', serverDockerfile],
  ]) {
    const builderStage = contents.slice(contents.indexOf('AS formal-ai-builder'), contents.indexOf('RUN cargo install formal-ai'));
    assert.match(builderStage, /apt-get install [^\n]*pkg-config/, `${name} must install pkg-config before building Formal AI`);
    assert.match(builderStage, /apt-get install [^\n]*libssl-dev/, `${name} must install the OpenSSL headers before building Formal AI`);
    assert.match(builderStage, /^ENV OPENSSL_STATIC=1$/m, `${name} must link OpenSSL statically so the copy into the runtime image carries no soname dependency`);
  }

  assert.match(serverDockerfile, /FROM rust:1\.96-slim-bookworm AS formal-ai-builder/, 'the service must build against a runtime-compatible glibc');
  assert.match(serverDockerfile, /FROM konard\/hive-mind-dind:/, 'the service image must extend the root Telegram/DinD image');
  assert.match(serverDockerfile, /formal-ai", "serve", "--agent-mode"/, 'the service image must start the agent-mode API');
  assert.match(verifyImageScript, /check_tool "Formal AI" formal-ai --version/, 'image verification must exercise the installed wrapper');
  assert.match(compose, /hostname: link-assistant-formal-ai/, 'the service must have the requested stable network hostname');
  assert.match(compose, /aliases:\s+- link-assistant-formal-ai/, 'the stable hostname must be registered in Compose DNS');
  // The Compose network and volume deliberately carry the same Docker names the
  // on-demand sidecar uses (issue #2146, PR #2147 review), so persisted memory
  // survives a move between the two deployment shapes, and the network is
  // `internal` so the always-on service is no more reachable than the sidecar.
  assert.match(compose, /^ {2}formal-ai:\n {4}name: hive-mind-formal-ai$/m, 'Compose must create the shared Formal AI network under the same Docker name as the sidecar');
  assert.match(compose, /^ {4}internal: true$/m, 'the Compose Formal AI network must carry no egress');
  assert.match(compose, /^ {2}formal-ai-memory:\n {4}name: hive-mind-formal-ai-memory$/m, 'the Compose memory volume must be the volume the sidecar reuses');
  assert.match(compose, /formal-ai-memory:\/home\/box\/\.formal-ai/, 'the Formal AI memory must survive service restarts');
  assert.match(compose, /HIVE_MIND_FORMAL_AI_SIDECAR=0/, 'a Compose deployment must not also start an on-demand sidecar');
  assert.match(compose, /HIVE_MIND_FORMAL_AI_BASE_URL=http:\/\/link-assistant-formal-ai:8080/, 'Hive Mind must use the persistent service endpoint');
});
