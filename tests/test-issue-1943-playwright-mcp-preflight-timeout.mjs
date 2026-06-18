#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1943: a Hive Mind `solve` run aborted before creating a pull request
 * with `❌ Playwright MCP preflight failed for Claude Code`.
 *
 * Root cause: the local preflight ran `timeout 5 claude mcp list`. That command
 * performs a live health check against every registered MCP server (Playwright
 * MCP launches a browser to report status), which can exceed five seconds. When
 * the `timeout` killed the probe, `ensureConnectedPlaywrightMcpServer` saw a
 * non-zero exit and returned `false`, so `solve.mjs` aborted the whole run.
 *
 * The fix: an inconclusive `mcp list` probe (timeout / crash / missing binary)
 * tells us nothing about Playwright's real status, so it must NOT abort the
 * solve. Instead, fall back to the local `@playwright/mcp` package check — if
 * the package is installed, the server can connect on demand via Tool Search
 * (issue #1901), so the working session should proceed. The probe timeout is
 * also now generous by default and overridable via
 * `PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS`.
 */

import assert from 'node:assert/strict';
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

const { ensureConnectedPlaywrightMcpServer, getPlaywrightMcpListTimeoutSeconds, PLAYWRIGHT_MCP_LIST_TIMEOUT_SECONDS_DEFAULT } = await import('../src/playwright-mcp.lib.mjs');

// A timed-out `claude mcp list` is reported by `timeout` as a non-zero exit
// (124) and command-stream surfaces a null result when it rejects. Reproduce
// both shapes.
const timedOutListResult = () => ({ code: 124, stdout: '', stderr: '' });

test('Issue #1943: probe timeout default is generous and overridable', () => {
  assert.equal(getPlaywrightMcpListTimeoutSeconds({}), PLAYWRIGHT_MCP_LIST_TIMEOUT_SECONDS_DEFAULT);
  assert.ok(PLAYWRIGHT_MCP_LIST_TIMEOUT_SECONDS_DEFAULT >= 30, 'default timeout should be at least 30s to survive live MCP health checks');
  assert.equal(getPlaywrightMcpListTimeoutSeconds({ PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS: '90' }), 90);
  // Invalid / non-positive values fall back to the default.
  assert.equal(getPlaywrightMcpListTimeoutSeconds({ PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS: 'abc' }), PLAYWRIGHT_MCP_LIST_TIMEOUT_SECONDS_DEFAULT);
  assert.equal(getPlaywrightMcpListTimeoutSeconds({ PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS: '0' }), PLAYWRIGHT_MCP_LIST_TIMEOUT_SECONDS_DEFAULT);
});

await asyncTest('Issue #1943: a timed-out mcp list probe does NOT abort the solve when @playwright/mcp is installed', async () => {
  let addCalls = 0;
  let listCalls = 0;
  const logs = [];

  const connected = await ensureConnectedPlaywrightMcpServer({
    list: async () => {
      listCalls++;
      return timedOutListResult();
    },
    add: async () => {
      addCalls++;
      return { code: 0, stdout: '', stderr: '' };
    },
    hasPackage: async () => true,
    log: async message => logs.push(message),
  });

  assert.equal(connected, true, 'inconclusive probe + installed package must let the solve proceed');
  assert.equal(addCalls, 0, 'a timed-out probe must not try to re-register over an unknown state');
  assert.equal(listCalls, 1, 'no second probe is needed once the package fallback decides');
  assert.ok(
    logs.some(message => message.includes('inconclusive')),
    'verbose diagnostics must explain the inconclusive probe'
  );
});

await asyncTest('Issue #1943: a null (rejected) mcp list probe also falls back to the package check', async () => {
  const connected = await ensureConnectedPlaywrightMcpServer({
    list: async () => null,
    add: async () => ({ code: 0 }),
    hasPackage: async () => true,
  });
  assert.equal(connected, true);
});

await asyncTest('Issue #1943: a timed-out probe still fails when @playwright/mcp is genuinely missing', async () => {
  const logs = [];
  const connected = await ensureConnectedPlaywrightMcpServer({
    list: async () => timedOutListResult(),
    add: async () => ({ code: 0 }),
    hasPackage: async () => false,
    log: async message => logs.push(message),
  });
  assert.equal(connected, false, 'with no package and no working probe, preflight must still fail');
  assert.ok(logs.some(message => message.includes('NOT installed')));
});

await asyncTest('Issue #1943: the inconclusive-probe fallback receives the log so package diagnostics surface', async () => {
  const packageLogs = [];
  await ensureConnectedPlaywrightMcpServer({
    list: async () => timedOutListResult(),
    add: async () => ({ code: 0 }),
    hasPackage: async ({ log } = {}) => {
      assert.equal(typeof log, 'function', 'hasPackage must receive the log callback');
      if (log) await log('package-diag');
      return true;
    },
    log: async message => packageLogs.push(message),
  });
  assert.ok(packageLogs.includes('package-diag'), 'package-level diagnostics must reach the caller log');
});

await asyncTest('Issue #1943: a connected probe is unaffected by the fallback (regression guard)', async () => {
  const connected = await ensureConnectedPlaywrightMcpServer({
    list: async () => ({ code: 0, stdout: 'playwright: npx @playwright/mcp@latest - ✓ Connected', stderr: '' }),
    add: async () => ({ code: 0 }),
    hasPackage: async () => {
      throw new Error('hasPackage must not be consulted when the server is already connected');
    },
  });
  assert.equal(connected, true);
});

await asyncTest('Issue #1943: a pending registration is still left untouched (issue #1901 regression guard)', async () => {
  let addCalls = 0;
  let packageChecks = 0;
  const connected = await ensureConnectedPlaywrightMcpServer({
    list: async () => ({ code: 0, stdout: 'playwright: npx @playwright/mcp@latest - pending', stderr: '' }),
    add: async () => {
      addCalls++;
      return { code: 0 };
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

await asyncTest('Issue #1943: solve.mjs still wires the local Playwright MCP preflight before the working session', async () => {
  const solveSource = await fsModule.promises.readFile(new URL('../src/solve.mjs', import.meta.url), 'utf-8');
  assert.ok(solveSource.includes('ensureSolvePlaywrightMcpReady'), 'solve.mjs should keep running the preflight');
  assert.ok(solveSource.includes("await safeExit(1, 'Playwright MCP preflight failed')"), 'solve.mjs should still abort when the package itself is unavailable');
});

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
