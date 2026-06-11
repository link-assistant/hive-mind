#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1901: a Claude Code system.init event can report Playwright MCP as
 * "pending" while no mcp__playwright__* tools are exposed. Hive Mind must not
 * treat that state as connected browser access.
 */

import assert from 'node:assert/strict';
import { createInteractiveHandler } from '../src/interactive-mode.lib.mjs';
import { hasConnectedPlaywrightMcpServer } from '../src/playwright-mcp.lib.mjs';
import { asyncTest, getFailCount, printSummary, test } from './test-helpers.mjs';

test('Issue #1901: Playwright MCP availability rejects pending list rows', () => {
  const output = 'playwright: npx @playwright/mcp@latest - pending';
  assert.equal(hasConnectedPlaywrightMcpServer(output), false);
});

test('Issue #1901: Playwright MCP availability accepts connected list rows', () => {
  const output = 'playwright: npx @playwright/mcp@latest - Connected';
  assert.equal(hasConnectedPlaywrightMcpServer(output), true);
});

test('Issue #1901: Codex-style enabled rows still count as available', () => {
  const output = `Name             Command  Args                    Env  Cwd  Status    Auth
playwright       npx      @playwright/mcp@latest  -    -    enabled   Unsupported`;
  assert.equal(hasConnectedPlaywrightMcpServer(output), true);
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

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
