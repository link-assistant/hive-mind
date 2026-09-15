#!/usr/bin/env node

/**
 * Issue #2259: the Codex Playwright-disable probe must inspect the same
 * CODEX_HOME that the eventual command uses.
 *
 * Formal AI deliberately removes the operator's MCP registrations from its
 * temporary config.  The old probe nevertheless read the operator home, found
 * `playwright`, and appended `mcp_servers.playwright.enabled=false` to the task
 * command.  In the MCP-free task config that override creates a table with no
 * command or URL, so Codex rejects it as `invalid transport` before requesting
 * a model response.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { executeCodexCommand } from '../src/codex.lib.mjs';
import { getCodexPlaywrightMcpDisableConfigArgs } from '../src/playwright-mcp.lib.mjs';

const OPERATOR_CONFIG = ['model = "gpt-5.5"', '', '[mcp_servers.playwright]', 'command = "npx"', 'args = ["-y", "@playwright/mcp@latest"]', ''].join('\n');
const FORMAL_AI_CONFIG = ['model = "formal-ai"', 'model_provider = "formal-ai"', '', '[model_providers.formal-ai]', 'base_url = "http://127.0.0.1:41235/api/openai/v1"', 'wire_api = "responses"', ''].join('\n');

const renderTaggedTemplate = (strings, values) => strings.reduce((rendered, part, index) => rendered + part + (index < values.length ? String(values[index]) : ''), '');

const withCodexHomes = async body => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-2259-'));
  const binDir = path.join(root, 'bin');
  const operatorHome = path.join(root, 'operator-codex');
  const formalAiHome = path.join(root, 'formal-ai-codex');
  const registeredHome = path.join(root, 'registered-codex');
  const workspace = path.join(root, 'workspace');
  await Promise.all([binDir, operatorHome, formalAiHome, registeredHome, workspace].map(dir => mkdir(dir, { recursive: true })));
  await Promise.all([writeFile(path.join(operatorHome, 'config.toml'), OPERATOR_CONFIG), writeFile(path.join(formalAiHome, 'config.toml'), FORMAL_AI_CONFIG), writeFile(path.join(registeredHome, 'config.toml'), `${FORMAL_AI_CONFIG}\n[mcp_servers.playwright]\ncommand = "npx"\n`)]);

  // The helper invokes `codex mcp list`. This deterministic stand-in models
  // Codex's config discovery closely enough to expose which CODEX_HOME it read.
  const fakeCodex = path.join(binDir, 'codex');
  await writeFile(fakeCodex, ['#!/bin/sh', 'if [ "$1" != "mcp" ] || [ "$2" != "list" ]; then', '  echo "unexpected fake codex invocation" >&2', '  exit 2', 'fi', 'if grep -q "^\\[mcp_servers\\.playwright\\]" "$CODEX_HOME/config.toml"; then', '  printf "Name        Command  Args     Env  Cwd  Status   Auth\\n"', '  printf "playwright  npx      @latest  -    -    enabled  Unsupported\\n"', 'else', '  printf "No MCP servers configured yet\\n"', 'fi', ''].join('\n'));
  await chmod(fakeCodex, 0o755);

  const previousPath = process.env.PATH;
  const previousCodexHome = process.env.CODEX_HOME;
  const effectivePath = `${binDir}${path.delimiter}${previousPath || ''}`;
  // Reproduce the operator process that launched Hive Mind. The task-specific
  // environment passed to executeCodexCommand points somewhere else.
  process.env.PATH = effectivePath;
  process.env.CODEX_HOME = operatorHome;
  try {
    return await body({ root, operatorHome, formalAiHome, registeredHome, workspace, env: { ...process.env, PATH: effectivePath } });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
};

const executeAgainstMcpFreeFormalAiHome = async ({ resume = null } = {}) =>
  withCodexHomes(async fixture => {
    const commands = [];
    let modelRequests = 0;
    const fakeDollar =
      options =>
      (strings, ...values) => {
        const command = renderTaggedTemplate(strings, values);
        commands.push({ command, options });
        const orphanPlaywrightTable = command.includes('mcp_servers.playwright.enabled=false');
        return {
          async *stream() {
            if (orphanPlaywrightTable) {
              yield { type: 'stderr', data: Buffer.from('Error loading config.toml: invalid transport\nin `mcp_servers.playwright`\n') };
              yield { type: 'exit', code: 1 };
              return;
            }
            modelRequests += 1;
            yield {
              type: 'stdout',
              data: Buffer.from(['{"type":"thread.started","thread_id":"issue-2259"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"message","type":"agent_message","text":"Model request reached."}}', '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'].join('\n')),
            };
            yield { type: 'exit', code: 0 };
          },
        };
      };

    const result = await executeCodexCommand({
      tempDir: fixture.workspace,
      branchName: 'issue-2259-regression',
      prompt: 'Reach the model request.',
      systemPrompt: '',
      argv: { model: 'gpt-5.5', resume, verbose: false, playwrightMcp: false },
      log: async () => {},
      formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
      forkedRepo: null,
      feedbackLines: [],
      codexPath: 'codex',
      $: fakeDollar,
      owner: null,
      repo: null,
      prNumber: null,
      capabilityPreflight: {
        codexHome: fixture.formalAiHome,
        baseCodexHome: fixture.operatorHome,
        codexBaseEnv: { ...fixture.env, CODEX_HOME: fixture.operatorHome },
      },
      calculatePricing: async () => null,
      verifyCapabilityExecutionCatalog: async () => ({}),
    });

    assert.equal(result.success, true, 'an MCP-free Formal AI config reaches Codex instead of failing config validation');
    assert.equal(modelRequests, 1, 'Codex reaches exactly one model request');
    assert.equal(commands.length, 1);
    assert.equal(commands[0].options.env.CODEX_HOME, fixture.formalAiHome, 'execution uses the MCP-free task home');
    assert.doesNotMatch(commands[0].command, /mcp_servers\.playwright\.enabled=false/u, 'no orphan server table is recreated');
    assert.equal(await readFile(path.join(fixture.operatorHome, 'config.toml'), 'utf8'), OPERATOR_CONFIG, 'the operator config is unchanged');
    assert.equal((await readFile(path.join(fixture.formalAiHome, 'config.toml'), 'utf8')).includes('mcp_servers'), false, 'the task config remains MCP-free');
    if (resume) assert.match(commands[0].command, /exec resume "existing-session"/u, 'the resumed invocation keeps its session id');
    else assert.doesNotMatch(commands[0].command, /exec resume/u, 'the fresh invocation starts a new session');
  });

test('Issue #2259: a fresh Codex session probes the MCP-free Formal AI home', async () => executeAgainstMcpFreeFormalAiHome());

test('Issue #2259: a resumed Codex session probes the MCP-free Formal AI home', async () => executeAgainstMcpFreeFormalAiHome({ resume: 'existing-session' }));

test('Issue #2259: a Playwright server in the effective config still receives a disable override', async () =>
  withCodexHomes(async fixture => {
    const args = await getCodexPlaywrightMcpDisableConfigArgs({
      env: { ...fixture.env, CODEX_HOME: fixture.registeredHome },
    });
    assert.deepEqual(args, ['-c', 'mcp_servers.playwright.enabled=false']);
    assert.equal(await readFile(path.join(fixture.registeredHome, 'config.toml'), 'utf8'), `${FORMAL_AI_CONFIG}\n[mcp_servers.playwright]\ncommand = "npx"\n`, 'disabling remains session-scoped');
  }));
