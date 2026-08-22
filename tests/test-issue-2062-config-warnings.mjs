#!/usr/bin/env node
/**
 * Regression coverage for issue #2062: explicit environment configuration
 * must not be silently discarded by parsing fallbacks or safety clamps.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let assertions = 0;

function assertEqual(actual, expected, message) {
  assertions++;
  assert.equal(actual, expected, message);
}

function assertMatch(actual, expected, message) {
  assertions++;
  assert.match(actual, expected, message);
}

function importWithEnv(moduleRelativePath, exportExpression, env) {
  const moduleUrl = pathToFileURL(resolve(moduleRelativePath)).href;
  const script = `const mod = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(${exportExpression}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });

  assertEqual(result.status, 0, result.stderr || 'spawned import should succeed');
  return {
    value: JSON.parse(result.stdout.trim().split('\n').at(-1)),
    stderr: result.stderr,
  };
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

const queueFloor = importWithEnv('src/queue-config.lib.mjs', 'mod.QUEUE_CONFIG.MIN_START_INTERVAL_MS', {
  HIVE_MIND_MIN_START_INTERVAL_MS: '300000',
});
assertEqual(queueFloor.value, 300000, 'explicit startup interval should be authoritative');
assertMatch(queueFloor.stderr, /\[queue-config\] HIVE_MIND_MIN_START_INTERVAL_MS=300000 is below the recommended 600000 ms;/, 'short startup interval should explain the recommended safety value');
assertMatch(queueFloor.stderr, /short intervals can start a backlog before host metrics settle \(#2015\)\./, 'short startup interval should explain the operational risk');

const deprecatedFloor = importWithEnv('src/queue-config.lib.mjs', 'mod.QUEUE_CONFIG.MIN_START_INTERVAL_MS', {
  HIVE_MIND_MIN_START_INTERVAL_MS: '60000',
  HIVE_MIND_MIN_START_INTERVAL_FLOOR_MS: '300000',
});
assertEqual(deprecatedFloor.value, 60000, 'deprecated floor should not override the authoritative interval');
assertMatch(deprecatedFloor.stderr, /\[queue-config\] HIVE_MIND_MIN_START_INTERVAL_FLOOR_MS is deprecated; use HIVE_MIND_MIN_START_INTERVAL_MS instead\./, 'deprecated floor should explain its replacement');

const cacheCeiling = importWithEnv('src/config.lib.mjs', 'mod.cacheTtl.system', {
  HIVE_MIND_SYSTEM_CACHE_TTL_MS: '300000',
});
assertEqual(cacheCeiling.value, 60000, 'system cache TTL should retain its safety ceiling');
assertMatch(cacheCeiling.stderr, /\[config\] HIVE_MIND_SYSTEM_CACHE_TTL_MS=300000 exceeds the maximum \(60000\); using 60000\./, 'system cache ceiling should explain the discarded value');

const invalidInteger = importWithEnv('src/config.lib.mjs', 'mod.timeouts.githubApiDelay', {
  HIVE_MIND_GITHUB_API_DELAY_MS: '300000ms',
});
assertEqual(invalidInteger.value, 5000, 'partially numeric integers should use the documented default');
assertMatch(invalidInteger.stderr, /\[config\] HIVE_MIND_GITHUB_API_DELAY_MS="300000ms" is not a valid integer; using default 5000\./, 'invalid integer fallback should identify the variable, raw value, and default');

const invalidFloat = importWithEnv('src/queue-config.lib.mjs', 'mod.QUEUE_CONFIG.RAM_THRESHOLD', {
  HIVE_MIND_RAM_THRESHOLD: '0.65oops',
});
assertEqual(invalidFloat.value, 0.65, 'partially numeric floats should use the documented default');
assertMatch(invalidFloat.stderr, /\[queue-config\] HIVE_MIND_RAM_THRESHOLD="0.65oops" is not a valid number; using default 0.65\./, 'invalid float fallback should identify the variable, raw value, and default');
assertEqual(countMatches(invalidFloat.stderr, /HIVE_MIND_RAM_THRESHOLD=/g), 1, 'a variable read more than once during startup should warn only once');

console.log(`Issue #2062 configuration warning tests passed (${assertions} assertions)`);
