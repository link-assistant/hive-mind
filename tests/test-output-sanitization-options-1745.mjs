#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 */

import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { postTrackedComment } from '../src/tool-comments.lib.mjs';
import { maskToken } from '../src/lib.mjs';

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const run = async (name, fn) => {
  process.stdout.write(`Testing ${name}... `);
  try {
    await fn();
    console.log('PASSED');
    passed++;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    failed++;
  }
};

const token = ['8490528355', ':', 'AAGHeNpjZJqWEytzt4iw1kfW2ouXly', 'ItOPT'].join('');

await run('dangerous output sanitization options are explicit and default false', async () => {
  const names = ['dangerously-skip-output-sanitization', 'dangerously-skip-code-output-sanitization', 'dangerously-skip-active-tokens-output-sanitization'];
  for (const name of names) {
    assert(SOLVE_OPTION_DEFINITIONS[name], `${name} should exist`);
    assert(SOLVE_OPTION_DEFINITIONS[name].type === 'boolean', `${name} should be boolean`);
    assert(SOLVE_OPTION_DEFINITIONS[name].default === false, `${name} should default false`);
  }
});

await run('postTrackedComment sanitizes controlled GitHub comment body', async () => {
  let postedPayload = null;
  const fakeDollar =
    options =>
    async (_strings, ..._values) => {
      postedPayload = options.stdin;
      return { code: 0, stdout: '{"id":123}', stderr: '' };
    };

  const result = await postTrackedComment({
    $: fakeDollar,
    owner: 'link-assistant',
    repo: 'hive-mind',
    targetNumber: 1746,
    body: `tool output ${token}`,
  });

  assert(result.ok === true, 'post should succeed');
  assert(postedPayload && !postedPayload.includes(token), 'payload must not contain raw token');
  assert(postedPayload.includes(maskToken(token)), 'payload should contain masked token');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
