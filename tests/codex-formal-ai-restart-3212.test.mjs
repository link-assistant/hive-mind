#!/usr/bin/env node

/**
 * Issue #3212: every Codex iteration of a `--model formal-ai` run must talk to
 * Formal AI, and a run that cannot must stop before Codex starts.
 *
 * The auto-restart iteration of a Formal AI run reached ChatGPT instead:
 *
 *   SessionConfiguredEvent { model_provider_id: "openai", … }
 *   {"type":"item.completed","item":{"type":"error","message":"Model metadata for `formal-ai` not found. …"}}
 *   {"type":"turn.failed","error":{"message":"{… \"status\":400 … The 'formal-ai' model is not supported when using Codex with a ChatGPT account.}"}}
 *
 * The capability preflight rewrites the repository-scoped CODEX_HOME's
 * config.toml from the operator config before each iteration. The first
 * iteration copied the Formal AI provider block back into it, but in doing so
 * it repointed the cached Formal AI runtime's own CODEX_HOME at the scoped
 * home. The restart therefore saw "already pinned" and skipped the copy, so
 * Codex ran with the operator config. The failure was then reported as the
 * "Model metadata" warning instead of the 400.
 *
 * Everything here is local: a stub `formal-ai`, `gh` and `codex` on PATH, an
 * in-process health endpoint, and a fake command runner standing in for the
 * Codex process.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { executeCodexCommand, getCodexErrorEventSummary, parseCodexExecJsonOutput } from '../src/codex.lib.mjs';
import { resetFormalAiRuntimeCache } from '../src/formal-ai-runtime.lib.mjs';
import { extractToolErrorCore } from '../src/lib.mjs';

const MODEL_METADATA_WARNING = 'Model metadata for `formal-ai` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.';
const CHATGPT_MODEL_REJECTION = "The 'formal-ai' model is not supported when using Codex with a ChatGPT account.";
const TURN_FAILED_400 = JSON.stringify({ type: 'turn.failed', error: { message: JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: CHATGPT_MODEL_REJECTION } }) } });
const MODEL_METADATA_ITEM = JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: MODEL_METADATA_WARNING } });
const SUCCESSFUL_TURN = ['{"type":"thread.started","thread_id":"issue-3212"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"message","type":"agent_message","text":"Done."}}', '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'];
const REJECTED_TURN = ['{"type":"thread.started","thread_id":"issue-3212"}', '{"type":"turn.started"}', MODEL_METADATA_ITEM, TURN_FAILED_400];

/** What the capability preflight writes into the scoped home on every iteration. */
const OPERATOR_CONFIG = 'model = "gpt-5.5"\n';
const PREFLIGHT_SCOPED_CONFIG = `${OPERATOR_CONFIG}\n[features]\nremote_plugin = false\n`;

// `formal-ai with --global … codex` merges its provider block and model
// catalog into $HOME/.codex, keeping the rest of the seeded config.
const FAKE_FORMAL_AI = `#!/bin/sh
case "$1" in
  --version) echo "formal-ai 0.352.1"; exit 0 ;;
  clients) echo '[{"id":"codex","default_protocol":"responses","endpoints":{"responses":"/api/openai/v1"},"global_configs":[{"path":".codex/config.toml","format":"toml"}]}]'; exit 0 ;;
  with)
    dir="$HOME/.codex"; mkdir -p "$dir"
    echo "$5" >> "$FAKE_FORMAL_AI_CALLS"
    [ "$FAKE_FORMAL_AI_WRITE_PROVIDER" = "0" ] && exit 0
    printf '{"models":[{"slug":"formal-ai","context_window":100000}]}\\n' > "$dir/formal-ai-model-catalog.json"
    {
      printf 'model = "formal-ai"\\nmodel_provider = "formalai"\\nmodel_catalog_json = "%s"\\n\\n' "$dir/formal-ai-model-catalog.json"
      awk '/^\\[model_providers\\.formalai\\]/{skip=1;next} /^\\[/{skip=0} !skip && !/^model/' "$dir/config.toml" 2>/dev/null
      printf '\\n[model_providers.formalai]\\nname = "formal-ai server"\\nbase_url = "%s/api/openai/v1"\\nenv_key = "FORMAL_AI_API_KEY"\\nwire_api = "responses"\\n' "$5"
    } > "$dir/config.toml.next"
    mv "$dir/config.toml.next" "$dir/config.toml"
    exit 0 ;;
esac
echo "unexpected formal-ai invocation: $*" >&2
exit 2
`;
const FAKE_GH = '#!/bin/sh\nexit 0\n';
const FAKE_CODEX = '#!/bin/sh\nif [ "$1" = "mcp" ] && [ "$2" = "list" ]; then printf "No MCP servers configured yet\\n"; exit 0; fi\nexit 0\n';

const renderTaggedTemplate = (strings, values) => strings.reduce((rendered, part, index) => rendered + part + (index < values.length ? String(values[index]) : ''), '');

const writeExecutable = async (file, content) => {
  await writeFile(file, content);
  await chmod(file, 0o755);
};

const withFormalAiCodexFixture = async body => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3212-'));
  const binDir = path.join(root, 'bin');
  const operatorHome = path.join(root, 'operator-codex');
  const scopedHome = path.join(root, 'scoped-codex');
  const formalAiHomeRoot = path.join(root, 'formal-ai-homes');
  const workspace = path.join(root, 'workspace');
  const formalAiCalls = path.join(root, 'formal-ai-calls.log');
  await Promise.all([binDir, operatorHome, scopedHome, formalAiHomeRoot, workspace].map(dir => mkdir(dir, { recursive: true })));
  await writeFile(path.join(operatorHome, 'config.toml'), OPERATOR_CONFIG);
  await writeExecutable(path.join(binDir, 'formal-ai'), FAKE_FORMAL_AI);
  await writeExecutable(path.join(binDir, 'gh'), FAKE_GH);
  await writeExecutable(path.join(binDir, 'codex'), FAKE_CODEX);

  const backend = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ version: '0.352.1', memory: { compatible: true } }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${backend.address().port}`;

  const previousPath = process.env.PATH;
  const previousCodexHome = process.env.CODEX_HOME;
  const effectivePath = `${binDir}${path.delimiter}${previousPath || ''}`;
  process.env.PATH = effectivePath;
  process.env.CODEX_HOME = operatorHome;
  resetFormalAiRuntimeCache();

  const env = {
    ...process.env,
    PATH: effectivePath,
    GH_TOKEN: 'test-token',
    HIVE_MIND_FORMAL_AI_BASE_URL: baseUrl,
    HIVE_MIND_FORMAL_AI_PATH: path.join(binDir, 'formal-ai'),
    HIVE_MIND_FORMAL_AI_HOME_ROOT: formalAiHomeRoot,
    FAKE_FORMAL_AI_CALLS: formalAiCalls,
  };

  /** Stand in for `prepareCodexCapabilityPreflight`: rewrite the scoped config from the operator config. */
  const runPreflight = async () => {
    await writeFile(path.join(scopedHome, 'config.toml'), PREFLIGHT_SCOPED_CONFIG);
    return { codexHome: scopedHome, baseCodexHome: operatorHome, codexBaseEnv: { ...env, CODEX_HOME: operatorHome } };
  };

  /** One Codex iteration. The fake runner records the config Codex would load at exec time. */
  const runIteration = async ({ events = SUCCESSFUL_TURN, envOverrides = {}, argvOverrides = {}, model = 'formal-ai', beforeExecution = async () => {} } = {}) => {
    const capabilityPreflight = await runPreflight();
    Object.assign(capabilityPreflight.codexBaseEnv, envOverrides);
    const logs = [];
    const executions = [];
    let launches = 0;
    const fakeDollar =
      options =>
      (strings, ...values) => {
        launches++;
        const command = renderTaggedTemplate(strings, values);
        return {
          async *stream() {
            const codexHome = options?.env?.CODEX_HOME;
            const config = codexHome ? await readFile(path.join(codexHome, 'config.toml'), 'utf8').catch(() => null) : null;
            executions.push({ command, codexHome, config });
            yield { type: 'stdout', data: Buffer.from(events.join('\n')) };
            yield { type: 'exit', code: events === SUCCESSFUL_TURN ? 0 : 1 };
          },
        };
      };
    const result = await executeCodexCommand({
      tempDir: workspace,
      branchName: 'issue-3212-regression',
      prompt: 'Solve the issue.',
      systemPrompt: '',
      argv: { model, resume: null, verbose: false, playwrightMcp: false, ...argvOverrides },
      log: async message => void logs.push(String(message)),
      formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
      forkedRepo: null,
      feedbackLines: [],
      codexPath: 'codex',
      $: fakeDollar,
      owner: null,
      repo: null,
      prNumber: null,
      capabilityPreflight,
      calculatePricing: async () => null,
      verifyCapabilityExecutionCatalog: async () => {
        await beforeExecution();
        return {};
      },
      waitForRetryDelay: async () => {},
    });
    return { result, logs, executions, launches };
  };

  try {
    return await body({ baseUrl, scopedHome, operatorHome, runIteration, formalAiCalls });
  } finally {
    resetFormalAiRuntimeCache();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await new Promise(resolve => backend.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
};

const assertFormalAiProvider = (config, baseUrl, label) => {
  assert.ok(config, `${label}: Codex had a config.toml to load`);
  assert.match(config, /^model_provider = "formalai"$/mu, `${label}: config.toml selects the Formal AI provider\n${config}`);
  assert.ok(config.includes('[model_providers.formalai]'), `${label}: config.toml defines the Formal AI provider\n${config}`);
  assert.ok(config.includes(`base_url = "${baseUrl}/api/openai/v1"`), `${label}: the provider points at the Formal AI server\n${config}`);
  assert.match(config, /^model_catalog_json = ".*formal-ai-model-catalog\.json"$/mu, `${label}: the formal-ai model metadata is registered\n${config}`);
};

test('Router Codex refuses a provider changed after capability preflight before command creation', { timeout: 30_000 }, async () =>
  withFormalAiCodexFixture(async ({ scopedHome, runIteration }) => {
    const { result, launches } = await runIteration({
      model: 'gpt-5.4',
      envOverrides: { HIVE_MIND_USE_ROUTER: '1', HIVE_MIND_ROUTER_TOKEN: 'synthetic-router-task', HIVE_MIND_ROUTER_AUTH_GUARD: '0', OPENAI_BASE_URL: 'https://router.invalid/v1' },
      beforeExecution: async () => writeFile(path.join(scopedHome, 'config.toml'), 'model_provider = "openai"\n'),
    });
    assert.equal(launches, 0, 'the command-stream runner must not start before Router admission');
    assert.equal(result.success, false);
    assert.ok(result.routerAuthViolation);
    assert.match(result.errorInfo.message, /Security violation.*router token/u);
  })
);

for (const selection of ['environment', 'argv']) {
  for (const resume of [false, true]) {
    test(`Router Codex preserves its admitted environment through shell startup: ${selection}, ${resume ? 'resume' : 'new'}`, { timeout: 30_000 }, async () =>
      withFormalAiCodexFixture(async ({ operatorHome, scopedHome, runIteration }) => {
        const thread = 'router-session-3785';
        const { result, executions } = await runIteration({
          model: 'gpt-5.4',
          envOverrides: { HOME: path.dirname(operatorHome), HIVE_MIND_USE_ROUTER: selection === 'environment' ? '1' : '0', HIVE_MIND_ROUTER_TOKEN: 'synthetic-router-task', OPENAI_API_KEY: 'synthetic-router-task', OPENAI_BASE_URL: 'https://router.invalid/v1' },
          argvOverrides: { useRouter: selection === 'argv', resume: resume ? thread : null },
          beforeExecution: async () => {
            await writeFile(path.join(scopedHome, 'config.toml'), 'model_provider = "hive-mind-router"\n[model_providers.hive-mind-router]\nbase_url = "https://router.invalid/v1"\nenv_key = "OPENAI_API_KEY"\n');
            await mkdir(path.join(scopedHome, 'sessions'), { recursive: true });
            await writeFile(path.join(scopedHome, 'sessions', `rollout-test-${thread}.jsonl`), '{}\n');
          },
        });
        assert.equal(result.success, true);
        assert.equal(executions.length, 1);
        assert.match(executions[0].command, /^sh -c /u, 'a Router task must not source a profile after authentication admission');
        if (resume) assert.ok(executions[0].command.includes(`exec resume "${thread}"`));
      })
    );
  }
}

test('Issue #3212: the auto-restart iteration still runs Codex against the Formal AI provider', async () =>
  withFormalAiCodexFixture(async ({ baseUrl, scopedHome, runIteration }) => {
    const first = await runIteration();
    assert.equal(first.result.success, true, `first iteration succeeds: ${first.result.result}`);
    assert.equal(first.executions.length, 1);
    assert.match(first.executions[0].command, /^sh -lc /u, 'ordinary Formal AI runs retain login-profile setup');
    assert.equal(first.executions[0].codexHome, scopedHome, 'Codex runs in the repository-scoped home');
    assertFormalAiProvider(first.executions[0].config, baseUrl, 'first iteration');

    // The auto-restart runs the capability preflight again, which rewrites the
    // scoped config.toml without the provider block, then executes Codex.
    const restart = await runIteration();
    assert.equal(restart.result.success, true, `restart succeeds: ${restart.result.result}`);
    assert.equal(restart.executions.length, 1);
    assert.equal(restart.executions[0].codexHome, scopedHome, 'the restart runs in the repository-scoped home');
    assertFormalAiProvider(restart.executions[0].config, baseUrl, 'auto-restart iteration');
    assert.ok(
      restart.logs.some(line => line.startsWith('🧠 Formal AI:')),
      `the restart logs its Formal AI wiring: ${JSON.stringify(restart.logs.filter(line => line.includes('Formal AI')))}`
    );

    // And a third iteration (auto-continue / resume) behaves the same way.
    const third = await runIteration();
    assertFormalAiProvider(third.executions[0].config, baseUrl, 'third iteration');
  }));

test('Issue #3212: a Formal AI run whose provider wiring is missing stops before Codex starts', async () =>
  withFormalAiCodexFixture(async ({ runIteration }) => {
    const { result, executions, logs } = await runIteration({ envOverrides: { FAKE_FORMAL_AI_WRITE_PROVIDER: '0' } });
    assert.equal(executions.length, 0, 'Codex is never started without the Formal AI provider');
    assert.equal(result.success, false);
    assert.match(result.result, /^Formal AI provider not configured/u, `the failure names the configuration problem: ${result.result}`);
    assert.match(extractToolErrorCore({ toolResult: result }), /^Formal AI provider not configured/u);
    assert.ok(
      logs.some(line => line.includes('Formal AI provider not configured')),
      'the log says why'
    );
  }));

test('Issue #3212: a ChatGPT-backend 400 in a Formal AI run is a configuration error, not the model metadata warning', async () =>
  withFormalAiCodexFixture(async ({ runIteration }) => {
    const { result } = await runIteration({ events: REJECTED_TURN });
    assert.equal(result.success, false);
    const reason = extractToolErrorCore({ toolResult: result });
    assert.doesNotMatch(reason, /Model metadata/u, `the fallback-metadata warning is not the failure reason: ${reason}`);
    assert.doesNotMatch(reason, /Authentication/iu);
    assert.ok(reason.includes(CHATGPT_MODEL_REJECTION), `the reason carries the 400 message: ${reason}`);
    assert.match(reason, /^Formal AI provider not configured/u, `the reason classifies it as configuration: ${reason}`);
    assert.equal(result.errorInfo.kind, 'configuration');
  }));

test('Issue #3212: the Model metadata warning never outranks turn.failed', () => {
  const state = parseCodexExecJsonOutput(REJECTED_TURN.join('\n'));
  assert.equal(state.authError, false, 'a 400 is not an authentication failure');
  const summary = getCodexErrorEventSummary(state);
  assert.equal(summary.hasError, true);
  assert.equal(summary.message, CHATGPT_MODEL_REJECTION);
  assert.ok(
    summary.ignoredEvents.some(event => event.message === MODEL_METADATA_WARNING),
    'the fallback-metadata warning is recorded as non-fatal'
  );
  assert.ok(!summary.events.some(event => event.message === MODEL_METADATA_WARNING));
});

test('Issue #3212: the Model metadata warning alone does not fail a completed turn or an unfinished one', () => {
  const alone = getCodexErrorEventSummary(parseCodexExecJsonOutput([SUCCESSFUL_TURN[0], SUCCESSFUL_TURN[1], MODEL_METADATA_ITEM].join('\n')));
  assert.equal(alone.hasError, false);
  assert.equal(alone.message, null);
});

test('Issue #3212: the pre-exec check refuses configs that would reach a vendor endpoint', async () => {
  const { assertFormalAiCodexConfig } = await import('../src/codex.formal-ai.lib.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3212-assert-'));
  const check = async config => {
    await writeFile(path.join(root, 'config.toml'), config);
    return assertFormalAiCodexConfig({ toolInvocation: { formalAi: true, baseUrl: 'http://127.0.0.1:41235', env: { CODEX_HOME: root } } });
  };
  try {
    await assert.rejects(check(OPERATOR_CONFIG), /^Error: Formal AI provider not configured: .*model_provider/u);
    await assert.rejects(check('model_provider = "openai"\n'), /Formal AI provider not configured/u);
    await assert.rejects(check('model_provider = "formalai"\n'), /Formal AI provider not configured: .*\[model_providers\.formalai\]/u);
    await assert.rejects(check('model_provider = "formalai"\n\n[model_providers.formalai]\nbase_url = "https://api.openai.com/v1"\n'), /Formal AI provider not configured: .*https:\/\/api\.openai\.com/u);
    await assert.rejects(assertFormalAiCodexConfig({ toolInvocation: { formalAi: true, env: {} } }), /Formal AI provider not configured: CODEX_HOME/u);

    const accepted = await check('model_provider = "formalai"\n\n[model_providers.formalai]\nbase_url = "http://127.0.0.1:41235/api/openai/v1"\n');
    assert.equal(accepted.providerId, 'formalai');
    assert.equal(accepted.baseUrl, 'http://127.0.0.1:41235/api/openai/v1');
    assert.equal(await assertFormalAiCodexConfig({ toolInvocation: { formalAi: false, env: {} } }), null, 'vendor runs are not checked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
