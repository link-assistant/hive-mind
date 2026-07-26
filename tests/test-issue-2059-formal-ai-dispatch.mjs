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
import { resolveFormalAiToolInvocation, validateFormalAiToolConnection } from '../src/formal-ai.lib.mjs';
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

  test(`--tool ${tool} dispatches --model formal-ai through formal-ai with`, () => {
    const invocation = resolveFormalAiToolInvocation({
      tool,
      model: 'formal-ai',
      toolPath: `/opt/hive/${tool}`,
      env: {},
    });

    assert.equal(invocation.command, 'formal-ai');
    assert.deepEqual(invocation.args, ['with', tool]);
    assert.equal(invocation.displayCommand, `formal-ai with ${tool}`);
    assert.equal(invocation.formalAi, true);
  });
}

test('a non-Formal-AI model keeps its configured tool command', () => {
  const invocation = resolveFormalAiToolInvocation({
    tool: 'agent',
    model: 'nemotron-3-super-free',
    toolPath: '/opt/hive/agent',
    env: {},
  });

  assert.equal(invocation.command, '/opt/hive/agent');
  assert.deepEqual(invocation.args, []);
  assert.equal(invocation.displayCommand, '/opt/hive/agent');
  assert.equal(invocation.formalAi, false);
});

test('a configured persistent server disables the wrapper-owned temporary server', () => {
  const invocation = resolveFormalAiToolInvocation({
    tool: 'codex',
    model: 'formal-ai',
    toolPath: 'codex',
    env: {
      HIVE_MIND_FORMAL_AI_PATH: '/opt/formal ai/formal-ai',
      HIVE_MIND_FORMAL_AI_BASE_URL: 'http://link-assistant-formal-ai:8080',
    },
  });

  assert.equal(invocation.command, '/opt/formal ai/formal-ai');
  assert.deepEqual(invocation.args, ['with', '--no-start-server', '--base-url', 'http://link-assistant-formal-ai:8080', 'codex']);
  assert.equal(invocation.displayCommand, "'/opt/formal ai/formal-ai' with --no-start-server --base-url http://link-assistant-formal-ai:8080 codex");
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
  assert.match(result.preparedCommand, /formal-ai with agent --model formalai\/formal-ai/);
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
  test(`--tool ${tool} prepares the wrapped executor command without execution`, async () => {
    const tempDir = await mkdtemp(join(tmpdir(), `issue-2059-${tool}-`));
    const previousHome = process.env.HOME;
    if (tool === 'claude') process.env.HOME = tempDir;

    try {
      const result = await execute(preparedCommandParams(tempDir, pathKey, tool));

      assert.equal(result.success, true);
      assert.equal(result.preparedOnly, true);
      assert.match(result.preparedCommand, new RegExp(`formal-ai with ${tool}`));
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

test('Formal AI connection validation checks the wrapper and selected CLI without starting a server', async () => {
  const calls = [];
  const result = await validateFormalAiToolConnection('qwen', {
    env: { HIVE_MIND_FORMAL_AI_PATH: '/opt/formal-ai' },
    run: async (command, args) => {
      calls.push({ command, args });
      return { stdout: 'qwen 1.2.3\n' };
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.version, 'qwen 1.2.3');
  assert.deepEqual(calls, [
    {
      command: '/opt/formal-ai',
      args: ['with', '--no-start-server', 'qwen', '--version'],
    },
  ]);
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

  assert.match(serverDockerfile, /FROM rust:1\.96-slim-bookworm AS formal-ai-builder/, 'the service must build against a runtime-compatible glibc');
  assert.match(serverDockerfile, /FROM konard\/hive-mind-dind:/, 'the service image must extend the root Telegram/DinD image');
  assert.match(serverDockerfile, /formal-ai", "serve", "--agent-mode"/, 'the service image must start the agent-mode API');
  assert.match(verifyImageScript, /check_tool "Formal AI" formal-ai --version/, 'image verification must exercise the installed wrapper');
  assert.match(compose, /hostname: link-assistant-formal-ai/, 'the service must have the requested stable network hostname');
  assert.match(compose, /aliases:\s+- link-assistant-formal-ai/, 'the stable hostname must be registered in Compose DNS');
  assert.match(compose, /formal-ai-network:\s+name: link-assistant-formal-ai/, 'Compose must create the requested stable Docker network');
  assert.match(compose, /formal-ai-memory:\/home\/box\/\.formal-ai/, 'the Formal AI memory must survive service restarts');
  assert.match(compose, /HIVE_MIND_FORMAL_AI_BASE_URL=http:\/\/link-assistant-formal-ai:8080/, 'Hive Mind must use the persistent service endpoint');
});
