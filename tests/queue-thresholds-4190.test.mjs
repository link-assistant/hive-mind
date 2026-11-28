/**
 * @hive-mind-test-suite default
 * Offline coverage for the shared queue admission default (issue #4190).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { resolveClaudeAuthorityCredentialsPath } from '../src/claude-auth-authority.lib.mjs';
import { formatCodexLimitsSection, formatUsageMessage, getCachedClaudeLimits, getCachedCodexLimits, getLimitCache, resolveLimitsCredentialPaths, resetLimitCache } from '../src/limits.lib.mjs';
import { DISPLAY_THRESHOLDS, QUEUE_CONFIG } from '../src/queue-config.lib.mjs';
import { checkApiLimits, checkSystemResources } from '../src/telegram-solve-queue.throttling.lib.mjs';

const fixtureHome = await mkdtemp(join(tmpdir(), 'queue-thresholds-4190-'));
after(() => rm(fixtureHome, { recursive: true, force: true }));
process.env.CODEX_HOME = join(fixtureHome, 'codex');
process.env.CLAUDE_CONFIG_DIR = join(fixtureHome, 'claude');
process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
process.env.HIVE_MIND_USE_ROUTER = '0';
for (const file of [await resolveClaudeAuthorityCredentialsPath(), resolveLimitsCredentialPaths().codex]) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, '{}');
}

const queue = { verbose: false, recordThrottle() {} };
const english = { locale: 'en' };
const expectedMetrics = {
  ram: 'RAM',
  cpu: 'CPU',
  disk: 'DISK',
  claude5Hour: 'CLAUDE_5_HOUR_SESSION',
  claudeWeekly: 'CLAUDE_WEEKLY',
  codex5Hour: 'CODEX_5_HOUR_SESSION',
  codexWeekly: 'CODEX_WEEKLY',
  githubApi: 'GITHUB_API',
};

test('all eight built-in defaults agree across admission, legacy fields, and display', () => {
  assert.deepEqual(Object.keys(QUEUE_CONFIG.thresholds).sort(), Object.keys(expectedMetrics).sort());
  for (const [metric, alias] of Object.entries(expectedMetrics)) {
    assert.equal(QUEUE_CONFIG.thresholds[metric].value, 0.618, metric);
    assert.equal(QUEUE_CONFIG[`${alias}_THRESHOLD`], 0.618, alias);
    assert.equal(DISPLAY_THRESHOLDS[alias], 61.8, alias);
  }
});

test('links notation takes precedence and individual overrides still apply to other metrics', { timeout: 15000 }, () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "import { QUEUE_CONFIG, DISPLAY_THRESHOLDS } from './src/queue-config.lib.mjs'; console.log(JSON.stringify({ disk: QUEUE_CONFIG.thresholds.disk, diskDisplay: DISPLAY_THRESHOLDS.DISK, github: QUEUE_CONFIG.thresholds.githubApi, legacyGithub: QUEUE_CONFIG.GITHUB_API_THRESHOLD, ram: QUEUE_CONFIG.thresholds.ram }));"], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      HIVE_MIND_QUEUE_CONFIG: '((disk (61.8% reject)))',
      HIVE_MIND_DISK_THRESHOLD: '0.8',
      HIVE_MIND_GITHUB_API_THRESHOLD: '0.5',
      HIVE_MIND_GITHUB_API_STRATEGY: 'dequeue-one-at-a-time',
    },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)), {
    disk: { value: 0.618, strategy: 'reject' },
    diskDisplay: 61.8,
    github: { value: 0.5, strategy: 'dequeue-one-at-a-time' },
    legacyGithub: 0.5,
    ram: { value: 0.618, strategy: 'enqueue' },
  });
});

for (const used of [3089, 3090]) {
  const atThreshold = used === 3090;
  test(`host and GitHub admission use ${used}/5000 before percentage rounding`, async () => {
    resetLimitCache();
    const cache = getLimitCache();
    const cpuLoad = { loadAvg5: used / 1000, cpuCount: 5, usageRatio: used / 5000, usagePercentage: 62 };
    const memory = { usedRatio: used / 5000, usedPercentage: 62, usedBytes: used, totalBytes: 5000 };
    const diskSpace = { ...memory, freePercentage: 38 };
    const githubRateLimit = { usedRatio: used / 5000, used, limit: 5000, usedPercentage: 62 };
    cache.set('cpu', { success: true, cpuLoad });
    cache.set('memory', { success: true, memory });
    cache.set('disk', { success: true, diskSpace });
    cache.set('github', { success: true, githubRateLimit });

    const host = await checkSystemResources(queue, 0, english);
    const github = await checkApiLimits(queue, true, 1, 'agent', english);
    assert.equal(host.ok, !atThreshold);
    assert.equal(github.ok, !atThreshold);
    assert.equal(host.reasons.length, atThreshold ? 3 : 0);
    assert.equal(github.reasons.length, atThreshold ? 1 : 0);
    for (const reason of [...host.reasons, ...github.reasons]) assert.match(reason, /threshold: 61\.8%/);
    assert.equal((await checkApiLimits(queue, false, 0, 'agent', english)).ok, true);
    const displayed = formatUsageMessage({}, diskSpace, githubRateLimit, cpuLoad, memory, null, [], english);
    assert.equal((displayed.match(/⚠️/gu) ?? []).length, atThreshold ? 4 : 0);
  });
}

for (const [tool, getCachedLimits] of [
  ['claude', getCachedClaudeLimits],
  ['codex', getCachedCodexLimits],
]) {
  for (const window of ['currentSession', 'allModels']) {
    test(`${tool} ${window} switches to one at a time at 61.8%`, { timeout: 10000 }, async () => {
      for (const percentage of [61.79, 61.8]) {
        resetLimitCache();
        const atThreshold = percentage === 61.8;
        const usage = { currentSession: { percentage: 0 }, allModels: { percentage: 0 }, [window]: { percentage } };
        await getCachedLimits(false, { fetchLimits: async () => ({ success: true, usage }) });
        getLimitCache().set('github', { success: true, githubRateLimit: { usedPercentage: 0 } });
        const idle = await checkApiLimits(queue, false, 0, tool, english);
        const busy = await checkApiLimits(queue, true, 1, tool, english);
        assert.equal(idle.ok, true);
        assert.equal(idle.oneAtATime, atThreshold);
        assert.equal(busy.ok, !atThreshold);
        if (atThreshold) assert.match(busy.reasons[0], /threshold: 61\.8%/);
        const displayed = tool === 'codex' ? formatCodexLimitsSection({ success: true, usage }, null, english) : formatUsageMessage(usage, null, null, null, null, null, [], english);
        assert.equal(displayed.includes('61.8% ⚠️'), atThreshold);
      }
    });
  }
}
