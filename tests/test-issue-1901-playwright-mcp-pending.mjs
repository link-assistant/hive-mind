#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1901: a Claude Code system.init event can report Playwright MCP as
 * "pending" while no mcp__playwright__* tools are exposed. Hive Mind must not
 * treat that state as connected browser access.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { asyncTest, getFailCount, printSummary, test } from './test-helpers.mjs';

const fsModule = await import('node:fs');
const osModule = await import('node:os');
const pathModule = await import('node:path');

globalThis.use = async name => {
  if (name === 'command-stream') return { $: () => ({ catch: async () => null }) };
  if (name === 'fs') return { ...fsModule, default: fsModule };
  if (name === 'os') return { ...osModule, default: osModule };
  if (name === 'path') return { ...pathModule, default: pathModule };
  return await import(name);
};

const { createInteractiveHandler } = await import('../src/interactive-mode.lib.mjs');
const { getPlaywrightMcpSessionInitFailure, isUnavailableMcpStatus } = await import('../src/interactive-mcp-status.lib.mjs');
const { ensureConnectedPlaywrightMcpServer, ensureSolvePlaywrightMcpReady, hasConnectedPlaywrightMcpServer } = await import('../src/playwright-mcp.lib.mjs');
const { formatVersionMessage } = await import('../src/version-info.lib.mjs');

const repoRoot = process.cwd();
const read = filePath => fs.readFile(path.join(repoRoot, filePath), 'utf-8');

test('Issue #1901: Playwright MCP availability rejects pending list rows', () => {
  const output = 'playwright: npx @playwright/mcp@latest - pending';
  assert.equal(hasConnectedPlaywrightMcpServer(output), false);
});

test('Issue #1901: Playwright MCP availability accepts connected list rows', () => {
  const output = 'playwright: npx @playwright/mcp@latest - Connected';
  assert.equal(hasConnectedPlaywrightMcpServer(output), true);
});

test('Issue #1901: Playwright MCP availability ignores timeout-action command arguments', () => {
  const output = 'playwright: npx -y @playwright/mcp@latest --isolated --headless --timeout-action=600000 - ✔ Connected';
  assert.equal(hasConnectedPlaywrightMcpServer(output), true);
});

test('Issue #1901: interactive status detection ignores timeout-action command arguments', () => {
  assert.equal(isUnavailableMcpStatus('npx @playwright/mcp --timeout-action=600000 - Connected'), false);
  assert.equal(isUnavailableMcpStatus('timeout'), true);
});

test('Issue #1901: Claude session init guard rejects pending Playwright without tools', () => {
  const failure = getPlaywrightMcpSessionInitFailure({
    playwrightMcpEnabled: true,
    event: {
      type: 'system',
      subtype: 'init',
      tools: ['Task', 'Bash', 'ToolSearch'],
      mcp_servers: [{ name: 'playwright', status: 'pending' }],
    },
  });

  assert.match(failure.message, /Playwright MCP is enabled/);
  assert.match(failure.message, /pending/);
  assert.match(failure.message, /mcp__playwright__/);
});

test('Issue #1901: Claude session init guard allows connected Playwright with Tool Search deferred tools', () => {
  const failure = getPlaywrightMcpSessionInitFailure({
    playwrightMcpEnabled: true,
    event: {
      type: 'system',
      subtype: 'init',
      tools: ['Task', 'Bash', 'ToolSearch'],
      mcp_servers: [{ name: 'playwright', status: 'connected' }],
    },
  });

  assert.equal(failure, null);
});

await asyncTest('Issue #1901: Claude stream handling aborts unusable Playwright MCP sessions', async () => {
  const claudeSource = await read('src/claude.lib.mjs');

  assert.match(claudeSource, /getPlaywrightMcpSessionInitFailure/);
  assert.match(claudeSource, /playwrightMcpEnabled: argv\.playwrightMcp !== false/);
  assert.match(claudeSource, /killProcessTree\('SIGTERM'\)/);
});

test('Issue #1901: Codex-style enabled rows still count as available', () => {
  const output = `Name             Command  Args                    Env  Cwd  Status    Auth
playwright       npx      @playwright/mcp@latest  -    -    enabled   Unsupported`;
  assert.equal(hasConnectedPlaywrightMcpServer(output), true);
});

test('Issue #1901: Playwright rows without connected/enabled status are not available', () => {
  const output = 'playwright: npx @playwright/mcp@latest';
  assert.equal(hasConnectedPlaywrightMcpServer(output), false);
});

test('Issue #1901: version output rejects pending Playwright MCP rows', () => {
  const message = formatVersionMessage({
    playwrightMcp: '@playwright/mcp@0.0.99',
    playwrightMcpClaudeStatus: 'playwright: npx @playwright/mcp@latest - pending',
    playwrightMcpCodexStatus: 'playwright       npx      @playwright/mcp@latest  -    -    enabled   Unsupported',
  });

  assert.match(message, /Playwright MCP: `0\.0\.99 \| Claude Code: not connected \| Codex: connected`/);
});

await asyncTest('Issue #1901: system.init comment warns when Playwright MCP is pending without tools', async () => {
  const comments = [];
  const execFile = async (_cmd, _args, options) => {
    comments.push(JSON.parse(options.input).body);
    return { stdout: JSON.stringify({ id: 1901, html_url: 'https://github.example/comment/1901' }) };
  };
  const handler = createInteractiveHandler({
    owner: 'link-assistant',
    repo: 'hive-mind',
    prNumber: 1907,
    log: async () => {},
    execFile,
  });

  await handler.processEvent({
    type: 'system',
    subtype: 'init',
    session_id: 'issue-1901-session',
    tools: ['Task', 'Bash', 'Read'],
    mcp_servers: [{ name: 'playwright', status: 'pending' }],
  });

  const comment = comments[0];
  assert.match(comment, /`playwright` \(pending - not connected; MCP tools unavailable\)/);
  assert.match(comment, /Playwright MCP server is pending, but no `mcp__playwright__/);
});

await asyncTest('Issue #1901: missing MCP registration is repaired with default command', async () => {
  const outputs = ['No MCP servers configured yet', 'playwright: npx @playwright/mcp@latest - ✓ Connected'];
  let listCalls = 0;
  let addCalls = 0;

  const connected = await ensureConnectedPlaywrightMcpServer({
    list: async () => ({ code: 0, stdout: outputs[listCalls++] || outputs.at(-1), stderr: '' }),
    add: async () => {
      addCalls++;
      return { code: 0, stdout: '', stderr: '' };
    },
    hasPackage: async () => true,
  });

  assert.equal(connected, true);
  assert.equal(addCalls, 1);
  assert.equal(listCalls, 2);
});

await asyncTest('Issue #1901: pending MCP registration is not overwritten by repair', async () => {
  let addCalls = 0;
  let packageChecks = 0;

  const connected = await ensureConnectedPlaywrightMcpServer({
    list: async () => ({ code: 0, stdout: 'playwright: npx @playwright/mcp@latest - pending', stderr: '' }),
    add: async () => {
      addCalls++;
      return { code: 0, stdout: '', stderr: '' };
    },
    hasPackage: async () => {
      packageChecks++;
      return true;
    },
  });

  assert.equal(connected, false);
  assert.equal(addCalls, 0);
  assert.equal(packageChecks, 0);
});

await asyncTest('Issue #1901: solve preflight repairs missing Claude Playwright MCP before work starts', async () => {
  const logs = [];
  let checkCalls = 0;
  const result = await ensureSolvePlaywrightMcpReady({
    argv: { tool: 'claude', playwrightMcp: true, promptPlaywrightMcp: true },
    checks: {
      claude: async () => {
        checkCalls++;
        return true;
      },
    },
    log: async message => logs.push(message),
  });

  assert.deepEqual(result, { ok: true, checkedTools: ['claude'], skipped: false });
  assert.equal(checkCalls, 1);
  assert.ok(logs.some(message => message.includes('Playwright MCP ready')));
});

await asyncTest('Issue #1901: solve preflight fails immediately when enabled Playwright MCP is unavailable', async () => {
  const logs = [];
  const result = await ensureSolvePlaywrightMcpReady({
    argv: { tool: 'codex', playwrightMcp: true, promptPlaywrightMcp: false },
    checks: {
      codex: async () => false,
    },
    log: async message => logs.push(message),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.checkedTools, ['codex']);
  assert.ok(logs.some(message => message.includes('Playwright MCP preflight failed for Codex')));
});

await asyncTest('Issue #1901: solve preflight honors --no-playwright-mcp', async () => {
  let checkCalls = 0;
  const result = await ensureSolvePlaywrightMcpReady({
    argv: { tool: 'claude', playwrightMcp: false, promptPlaywrightMcp: false },
    checks: {
      claude: async () => {
        checkCalls++;
        return false;
      },
    },
    log: async () => {},
  });

  assert.deepEqual(result, { ok: true, checkedTools: [], skipped: true });
  assert.equal(checkCalls, 0);
});

await asyncTest('Issue #1901: solve runs Playwright MCP preflight before starting a working session', async () => {
  const solveSource = await read('src/solve.mjs');
  const preflightIndex = solveSource.indexOf('ensureSolvePlaywrightMcpReady');
  const beginSessionIndex = solveSource.indexOf('beginWorkingSession()');

  assert.ok(preflightIndex > -1, 'solve.mjs should call ensureSolvePlaywrightMcpReady');
  assert.ok(beginSessionIndex > -1, 'solve.mjs should mark AI working session start');
  assert.ok(preflightIndex < beginSessionIndex, 'Playwright MCP preflight should run before the AI working session starts');
  assert.ok(solveSource.includes("await safeExit(1, 'Playwright MCP preflight failed')"), 'solve.mjs should fail immediately when Playwright MCP preflight fails');
});

await asyncTest('Issue #1901: skip-tool-connection-check does not skip local Playwright MCP preflight', async () => {
  const solveSource = await read('src/solve.mjs');

  assert.doesNotMatch(solveSource, /if\s*\(!skipToolConnectionCheck\)\s*{\s*const playwrightMcpPreflight = await ensureSolvePlaywrightMcpReady/s);
  assert.match(solveSource, /if\s*\(!argv\.dryRun && argv\.playwrightMcp !== false\)\s*{\s*const playwrightMcpPreflight = await ensureSolvePlaywrightMcpReady/s);
  assert.ok(!solveSource.includes('skip-tool-connection-check enabled'), 'Playwright MCP preflight skip message should not mention skip-tool-connection-check');
});

await asyncTest('Issue #1901: Docker image verification rejects unavailable Playwright MCP rows', async () => {
  const verifyScript = await read('scripts/verify-docker-image.sh');
  assert.match(verifyScript, /PLAYWRIGHT_MCP_UNAVAILABLE_RE=/);
  assert.match(verifyScript, /PLAYWRIGHT_MCP_CONNECTED_RE=/);
  assert.match(verifyScript, /npx --no-install @playwright\/mcp --help/);
  assert.match(verifyScript, /verify_playwright_mcp_rows "Claude"/);
  assert.match(verifyScript, /verify_playwright_mcp_rows "Codex"/);

  for (const filePath of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
    const dockerfile = await read(filePath);
    assert.match(dockerfile, /npx --no-install @playwright\/mcp --help/);
    assert.match(dockerfile, /playwright\.\*\(connected\|enabled\)/);
    assert.match(dockerfile, /pending\|disabled\|failed\|error\|disconnected/);
  }
});

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
