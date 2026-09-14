#!/usr/bin/env node

/**
 * Issue #2247 (H7): a `--model formal-ai --tool codex` task must not inherit the
 * operator's MCP servers.
 *
 * The Rust reproduction run
 * (https://github.com/link-assistant/hive-mind/issues/2247) fetched the GitHub
 * issue through the operator's ChatGPT connector instead of through `gh`, and
 * echoed the raw JSON it got back as its final answer. Log line 601 of that run:
 *
 *   mcp_server=codex_apps mcp_server_origin=https://chatgpt.com … auth_mode="Chatgpt"
 *
 * The connector was reachable because `seedFormalAiClientHome` copied the whole
 * of `~/.codex` into the task home with `cp --recursive`. That directory
 * routinely declares MCP servers: the container this was reproduced in has
 *
 *   [mcp_servers.playwright]
 *   command = "npx"
 *
 * in `~/.codex/config.toml`. The fix seeds one credential (`auth.json`) and a
 * `config.toml` with every `mcp_servers` declaration removed, and nothing else.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

import { CODEX_SEEDED_FILES, seedFormalAiClientHome, stripCodexMcpServers } from '../src/formal-ai-runtime.lib.mjs';

// --- 1. stripCodexMcpServers removes every spelling of the declaration -------

{
  // The exact shape found in the reproduction container's ~/.codex/config.toml.
  const operatorConfig = ['[mcp_servers.playwright]', 'command = "npx"', 'args = ["-y", "@playwright/mcp@latest", "--isolated", "--headless"]', ''].join('\n');
  const stripped = stripCodexMcpServers(operatorConfig);
  assert.equal(stripped.includes('mcp_servers'), false, 'the playwright MCP table is gone');
  assert.equal(stripped.includes('@playwright/mcp'), false, 'and so is its argument list');

  const mixed = ['model = "gpt-5"', 'mcp_servers.codex_apps.url = "https://chatgpt.com/backend-api/codex/mcp"', '', '[features]', 'remote_plugin = false', '', '[mcp_servers]', 'enabled = true', '', '[[mcp_servers.linear]]', 'command = "linear-mcp"', '', '[tui]', 'mcp_servers = "this key belongs to [tui], not to the root table"', ''].join('\n');
  const strippedMixed = stripCodexMcpServers(mixed);

  assert.equal(strippedMixed.includes('codex_apps'), false, 'root-scope dotted keys are removed');
  assert.equal(strippedMixed.includes('[mcp_servers]'), false, 'the bare table is removed');
  assert.equal(strippedMixed.includes('linear'), false, 'array-of-tables entries are removed');
  assert.ok(strippedMixed.includes('model = "gpt-5"'), 'unrelated root keys survive');
  assert.ok(strippedMixed.includes('remote_plugin = false'), 'unrelated tables survive (issue #2077 pins this one)');
  assert.ok(strippedMixed.includes('[tui]'), '[tui] survives');
  assert.ok(strippedMixed.includes('this key belongs to [tui]'), "a key named mcp_servers inside another table is that table's, and is left alone");

  assert.equal(stripCodexMcpServers('model = "gpt-5"\n'), 'model = "gpt-5"\n', 'a config without MCP servers is returned unchanged');
  assert.equal(stripCodexMcpServers(''), '', 'an empty config is returned unchanged');
}

// --- 2. Only auth.json and a filtered config.toml reach the task home --------

{
  const copied = [];
  const written = [];
  const made = [];
  const operatorConfig = '[mcp_servers.playwright]\ncommand = "npx"\n\n[features]\nremote_plugin = false\n';

  const seeded = await seedFormalAiClientHome({
    client: { id: 'codex', global_configs: [{ format: 'toml', path: '.codex/config.toml' }] },
    home: '/tmp/isolated-home',
    realHome: '/home/operator',
    // Issue #2074: Hive Mind may already have repointed CODEX_HOME at a
    // repository-scoped home; that is still the source of the two files.
    env: { CODEX_HOME: '/tmp/hive-codex-home-abc' },
    cpImpl: async (source, destination, options) => void copied.push({ source, destination, options }),
    mkdirImpl: async (dir, options) => void made.push({ dir, options }),
    readFileImpl: async path => {
      if (path === '/tmp/hive-codex-home-abc/config.toml') return operatorConfig;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    writeFileImpl: async (path, contents) => void written.push({ path, contents }),
  });

  assert.deepEqual(made, [{ dir: '/tmp/isolated-home/.codex', options: { recursive: true } }]);

  // The defect: a single recursive copy of the whole operator home.
  assert.deepEqual(
    copied,
    [
      {
        source: '/tmp/hive-codex-home-abc/auth.json',
        destination: '/tmp/isolated-home/.codex/auth.json',
        options: { verbatimSymlinks: true, force: true },
      },
    ],
    'exactly one file is copied verbatim, and it is the credential'
  );
  assert.equal(
    copied.some(call => call.options?.recursive),
    false,
    'no recursive copy of ~/.codex — plugins/, skills/, sessions/ and history.jsonl stay with the operator'
  );

  assert.equal(written.length, 1);
  assert.equal(written[0].path, '/tmp/isolated-home/.codex/config.toml');
  assert.equal(written[0].contents.includes('mcp_servers'), false, 'the seeded config declares no MCP server');
  assert.ok(written[0].contents.includes('remote_plugin = false'), 'unrelated operator settings are preserved');

  assert.deepEqual(seeded, ['/tmp/hive-codex-home-abc/auth.json → .codex/auth.json', '/tmp/hive-codex-home-abc/config.toml → .codex/config.toml (mcp_servers removed)'], 'the notes say what was seeded and that MCP servers were dropped');

  assert.deepEqual([...CODEX_SEEDED_FILES], ['auth.json', 'config.toml']);
}

// --- 3. A Codex home that does not exist yet is not an error -----------------

{
  const seeded = await seedFormalAiClientHome({
    client: { id: 'codex', global_configs: [{ format: 'toml', path: '.codex/config.toml' }] },
    home: '/tmp/isolated-home',
    realHome: '/home/operator',
    env: {},
    cpImpl: async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    mkdirImpl: async () => {},
    readFileImpl: async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    writeFileImpl: async () => {
      throw new Error('nothing to write');
    },
  });
  assert.deepEqual(seeded, [], 'Formal AI writes a fresh config when the operator has none');
}

// --- 4. Other tools keep the recursive seeding they rely on ------------------

{
  const copied = [];
  const seeded = await seedFormalAiClientHome({
    client: { id: 'agent', global_configs: [{ format: 'json', path: '.config/link-assistant-agent/opencode.json' }] },
    home: '/tmp/isolated-home',
    realHome: '/home/operator',
    env: {},
    cpImpl: async (source, destination, options) => void copied.push({ source, destination, options }),
  });

  assert.deepEqual(copied, [
    {
      source: '/home/operator/.config/link-assistant-agent',
      destination: '/tmp/isolated-home/.config/link-assistant-agent',
      options: { recursive: true, verbatimSymlinks: true, force: true },
    },
  ]);
  assert.deepEqual(seeded, ['/home/operator/.config/link-assistant-agent → .config/link-assistant-agent']);
}

console.log('PASS: issue #2247 (H7) a formal-ai Codex task seeds one credential and no MCP servers');
