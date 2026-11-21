/** Offline reproduction using the exact pre-fix process counter from main. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { getLimitCache } from '../../src/limits.lib.mjs';
import { SolveQueue } from '../../src/telegram-solve-queue.lib.mjs';
import { classifyToolProcesses } from '../../src/queue-work.lib.mjs';

const source = execFileSync('git', ['show', 'b92e0596b:src/telegram-solve-queue.helpers.lib.mjs'], { encoding: 'utf8' });
const original = source.slice(source.indexOf('export async function getRunningProcesses('), source.indexOf('/**\n * Count running claude processes.')).replace('export ', '');
// The actual old counter consumes synthetic pgrep output; no provider requests,
// subprocesses representing vendors, credentials or service termination.
const oldCounter = new Function('execAsync', `${original}\nreturn getRunningProcesses;`)(async () => ({ stdout: '10 codex\n11 codex\n' }));
const records = [
  { pid: 10, ppid: 1, argv: ['codex', 'app-server', 'daemon', 'pid-update-loop'] },
  { pid: 11, ppid: 10, argv: ['codex', 'app-server', '--listen', 'unix://', '--managed-daemon'] },
];
const queue = new SolveQueue({ autoStart: false, getToolProcessSnapshot: async () => classifyToolProcesses(records), getRunningSessionItems: async () => [] });
queue.checkSystemResources = async () => ({ ok: true, reasons: [] });
const cache = getLimitCache();
cache.set('codex', { success: true, usage: { currentSession: { percentage: 10 }, allModels: { percentage: 98 } } });
cache.set('github', { success: true, githubRateLimit: { usedPercentage: 10 } });
const before = await oldCounter('codex');
assert.equal(before.count, 2);
assert.equal((await queue.checkApiLimits(before.count > 0, 0, 'codex')).ok, false);
console.log('Before: 2 idle services counted; 98% weekly usage blocks dispatch.');
const after = await queue.canStartCommand({ tool: 'codex' });
assert.equal(after.codexProcesses, 0);
assert.equal(after.canStart, true);
assert.equal(after.oneAtATime, true);
console.log('After: 0 active jobs; 98% weekly usage admits one task.');
