#!/usr/bin/env node
/**
 * Issue #1745 — verify the process-wide sanitization counters and the
 * end-of-run summary line.
 *
 * Comment #4364642786 requirement: "then program finishes and output contained
 * any sanitized access tokens, we should show stats - how many of them used,
 * and if it is more than 0, we should add a note, that by using
 * --dangerously-skip-output-sanitization we can skip sanitization if it
 * blocks user workflow."
 *
 * @hive-mind-test-suite default
 */

import { sanitizeOutput, sanitizeCommentBody, getSanitizationStats, resetSanitizationStats, formatSanitizationSummary, extractTokensFromUserContent } from '../src/token-sanitization.lib.mjs';

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const run = async (name, fn) => {
  process.stdout.write(`Testing ${name}... `);
  try {
    resetSanitizationStats();
    await fn();
    console.log('PASSED');
    passed++;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    failed++;
  }
};

const githubToken = 'ghp_' + 'A'.repeat(36);
const stripeKey = 'sk_live_' + 'B'.repeat(40);
const telegramToken = ['8490528355', ':', 'AAGHeNpjZJqWEytzt4iw1kfW2ouXly', 'ItOPT'].join('');

await run('counters start at zero after reset', async () => {
  const stats = getSanitizationStats();
  assert(stats.totalMasked === 0, 'totalMasked should be 0');
  assert(stats.knownTokenMasks === 0, 'knownTokenMasks should be 0');
  assert(stats.patternMasks === 0, 'patternMasks should be 0');
  assert(stats.hexMasks === 0, 'hexMasks should be 0');
  assert(stats.excluded === 0, 'excluded should be 0');
});

await run('pattern detection increments patternMasks and totalMasked', async () => {
  const out = await sanitizeOutput(`Some output containing ${githubToken} and ${stripeKey}.`);
  assert(!out.includes(githubToken), 'github token should be masked');
  assert(!out.includes(stripeKey), 'stripe key should be masked');
  const stats = getSanitizationStats();
  assert(stats.patternMasks >= 2, `patternMasks should be >= 2, got ${stats.patternMasks}`);
  assert(stats.totalMasked >= 2, `totalMasked should be >= 2, got ${stats.totalMasked}`);
});

await run('formatSanitizationSummary returns empty when nothing masked', async () => {
  const summary = formatSanitizationSummary();
  assert(summary === '', `expected empty, got: ${summary}`);
});

await run('formatSanitizationSummary contains skip-flag note when totalMasked > 0', async () => {
  await sanitizeOutput(`leak: ${githubToken}`);
  const summary = formatSanitizationSummary();
  assert(summary.includes('Output sanitization'), 'should mention sanitization');
  assert(summary.includes('--dangerously-skip-output-sanitization'), 'should mention skip flag');
  assert(summary.includes('--dangerously-skip-active-tokens-output-sanitization'), 'should mention active-tokens flag');
});

await run('excludeTokens carve-out keeps pre-existing user content untouched', async () => {
  const userProvidedToken = githubToken; // user typed this in their issue body
  const newToken = stripeKey; // came from somewhere else (AI tool stdout)
  const body = `User-provided: ${userProvidedToken}. Bash output: ${newToken}.`;
  const out = await sanitizeOutput(body, { excludeTokens: [userProvidedToken] });
  assert(out.includes(userProvidedToken), `user token should be preserved (carve-out): ${out}`);
  assert(!out.includes(newToken), 'new token should still be masked');
  const stats = getSanitizationStats();
  assert(stats.excluded >= 1, `excluded should be >= 1, got ${stats.excluded}`);
});

await run('sanitizeCommentBody also honors excludeTokens carve-out', async () => {
  const body = `User token: ${githubToken}. Tool token: ${stripeKey}.`;
  const out = await sanitizeCommentBody(body, { excludeTokens: [githubToken], knownTokens: [] });
  assert(out.includes(githubToken), 'user-provided token should remain visible');
  assert(!out.includes(stripeKey), 'tool-provided token should be masked');
});

await run('skipOutputSanitization disables pattern masking but the summary still reflects state', async () => {
  const before = getSanitizationStats().totalMasked;
  const body = `Skipped: ${stripeKey}`;
  const out = await sanitizeOutput(body, { skipOutputSanitization: true });
  // skipOutputSanitization preserves the body since active-token masking has nothing to mask here
  assert(out === body, 'output should pass through unchanged');
  const after = getSanitizationStats().totalMasked;
  assert(after === before, `totalMasked should not increase, before=${before} after=${after}`);
});

await run('telegram token in pattern path increments stats correctly', async () => {
  const out = await sanitizeOutput(`bot: ${telegramToken}`);
  assert(!out.includes(telegramToken), 'telegram token should be masked');
  const stats = getSanitizationStats();
  assert(stats.totalMasked >= 1, 'totalMasked should reflect the masking');
});

await run('extractTokensFromUserContent returns token-shaped strings from user text', async () => {
  const userText = `User typed: ${githubToken} and ${stripeKey} in the issue.`;
  const tokens = await extractTokensFromUserContent(userText);
  assert(tokens.includes(githubToken), `should include github token, got: ${tokens.join(',')}`);
  assert(tokens.includes(stripeKey), `should include stripe key, got: ${tokens.join(',')}`);
});

await run('extractTokensFromUserContent filters out active local tokens', async () => {
  const userText = `Mention of ${githubToken} and ${stripeKey} together.`;
  const knownActive = [{ value: githubToken, name: 'GH_TOKEN', source: 'env' }];
  const tokens = await extractTokensFromUserContent(userText, { knownTokens: knownActive });
  assert(!tokens.includes(githubToken), 'active local token must NOT be in carve-out');
  assert(tokens.includes(stripeKey), 'non-active token should still be in carve-out');
});

await run('end-to-end: user content carve-out keeps user tokens, masks fresh leaks', async () => {
  const userBody = `Reproduce: my key is ${githubToken}`;
  const userTokens = await extractTokensFromUserContent(userBody);
  // AI later emits a comment that quotes the user's key plus a fresh tool-stdout key
  const aiComment = `User said: ${githubToken}. Tool output: ${stripeKey}.`;
  const out = await sanitizeOutput(aiComment, { excludeTokens: userTokens });
  assert(out.includes(githubToken), 'user-typed token must remain visible');
  assert(!out.includes(stripeKey), 'fresh tool-stdout token must be masked');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
