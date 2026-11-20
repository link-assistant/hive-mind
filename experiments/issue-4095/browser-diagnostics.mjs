import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Use the same installed browser client as the Playwright MCP command.
const cli = realpathSync(execFileSync('bash', ['-c', 'command -v playwright-mcp'], { encoding: 'utf8' }).trim());
const { chromium } = createRequire(cli)('playwright');
const manager = fileURLToPath(new URL('../../src/hive-manager/cli.sh', import.meta.url));
const server = await chromium.launchServer({ channel: 'chrome', headless: true });
try {
  const pid = server.process().pid;
  const { stdout } = await promisify(execFile)(manager, ['tasks', 'check-browser', String(pid)], { maxBuffer: 4096 });
  const report = JSON.parse(stdout);
  assert.equal(report.pid, pid);
  assert.ok(report.processes > 1);
  assert.ok(report.cpuCores >= 0);
  assert.equal(report.approval, null);
  assert.equal(report.signaled, false);
  assert.equal(server.process().exitCode, null);
  console.log('Sampled a real headless Chromium process tree');
} finally {
  await server.close();
}
