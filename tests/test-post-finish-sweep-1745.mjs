#!/usr/bin/env node
/**
 * Issue #1745 — verify the post-finish sanitization sweep edits bot-authored
 * comments and PR descriptions in place when they contain leaked tokens.
 *
 * Comment #4364642786: "after AI finishes whatever the content was ... we
 * should by default go and mask the token by editing comments, pull
 * requests".
 *
 * @hive-mind-test-suite default
 */

import { sweepPrConversationComments, sweepPrDescription } from '../src/post-finish-sanitization-sweep.lib.mjs';
import { resetSanitizationStats } from '../src/token-sanitization.lib.mjs';

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

/**
 * Build a minimal fake `$` that supports both
 *   $`...`                                  → tagged template
 *   $({ stdin: payload })`...`              → options-then-tag
 * It dispatches based on the joined raw command string and a sequence of
 * scripted responses.
 */
const makeFakeDollar = scripted => {
  const calls = [];
  const dispatch = (rawArgs, values, lastOptions) => {
    const raw = String.raw({ raw: rawArgs }, ...values.map(v => String(v)));
    calls.push({ raw, options: lastOptions });
    const handler = scripted.find(s => s.match.test(raw));
    if (!handler) {
      return Promise.resolve({ code: 1, stdout: '', stderr: 'no scripted match for: ' + raw });
    }
    return Promise.resolve(typeof handler.respond === 'function' ? handler.respond({ raw, options: lastOptions }) : handler.respond);
  };
  const $ = (...firstArgs) => {
    if (Array.isArray(firstArgs[0]) && firstArgs[0].raw) {
      // direct tagged template
      return dispatch(firstArgs[0].raw, firstArgs.slice(1), {});
    }
    const options = firstArgs[0] || {};
    return (rawArgs, ...values) => dispatch(rawArgs.raw, values, options);
  };
  $.calls = calls;
  return $;
};

await run('sweepPrConversationComments edits bot-authored comments containing tokens', async () => {
  const leakedBody = `Tool stdout: TOKEN=${githubToken} more text`;
  const cleanBody = 'Just a normal comment, no secrets';
  const comments = [
    { id: 1, user: { login: 'bot-user' }, body: leakedBody },
    { id: 2, user: { login: 'bot-user' }, body: cleanBody },
    { id: 3, user: { login: 'someone-else' }, body: leakedBody },
  ];
  const $ = makeFakeDollar([
    { match: /repos\/o\/r\/issues\/1\/comments --paginate/, respond: { code: 0, stdout: JSON.stringify(comments), stderr: '' } },
    { match: /repos\/o\/r\/issues\/comments\/1 -X PATCH --input -/, respond: { code: 0, stdout: '{}', stderr: '' } },
  ]);
  const stats = await sweepPrConversationComments({
    $,
    owner: 'o',
    repo: 'r',
    prNumber: 1,
    botLogin: 'bot-user',
  });
  assert(stats.scanned === 2, `scanned should be 2 (skip non-bot), got ${stats.scanned}`);
  assert(stats.edited === 1, `edited should be 1 (only the leaked one), got ${stats.edited}`);
  assert(stats.errors === 0, `no errors expected, got ${stats.errors}`);

  // Verify the edit payload didn't include the raw token
  const editCall = $.calls.find(c => /comments\/1 -X PATCH/.test(c.raw));
  assert(editCall, 'should have made an edit call for comment 1');
  assert(editCall.options && typeof editCall.options.stdin === 'string', 'edit must include stdin payload');
  assert(!editCall.options.stdin.includes(githubToken), 'edit payload must not include raw token');
});

await run('sweepPrConversationComments leaves clean comments alone', async () => {
  const cleanBody = 'No secrets here';
  const comments = [{ id: 99, user: { login: 'bot-user' }, body: cleanBody }];
  const $ = makeFakeDollar([{ match: /repos\/o\/r\/issues\/1\/comments --paginate/, respond: { code: 0, stdout: JSON.stringify(comments), stderr: '' } }]);
  const stats = await sweepPrConversationComments({ $, owner: 'o', repo: 'r', prNumber: 1, botLogin: 'bot-user' });
  assert(stats.scanned === 1);
  assert(stats.edited === 0, 'no edit expected');
  // No PATCH call should have happened
  const editCall = $.calls.find(c => /PATCH/.test(c.raw));
  assert(!editCall, 'should not have called PATCH');
});

await run('sweepPrDescription edits leaked PR body', async () => {
  const prBody = `Summary: leaked ${githubToken} in description.`;
  const $ = makeFakeDollar([
    { match: /repos\/o\/r\/pulls\/7$/, respond: { code: 0, stdout: JSON.stringify({ body: prBody }), stderr: '' } },
    { match: /repos\/o\/r\/pulls\/7 -X PATCH --input -/, respond: { code: 0, stdout: '{}', stderr: '' } },
  ]);
  const stats = await sweepPrDescription({ $, owner: 'o', repo: 'r', prNumber: 7 });
  assert(stats.scanned === 1);
  assert(stats.edited === 1);
  const editCall = $.calls.find(c => /pulls\/7 -X PATCH/.test(c.raw));
  assert(editCall.options && !editCall.options.stdin.includes(githubToken), 'edit payload must not contain raw token');
});

await run('sweepPrDescription is a no-op when body is clean', async () => {
  const prBody = 'Just a clean description';
  const $ = makeFakeDollar([{ match: /repos\/o\/r\/pulls\/9$/, respond: { code: 0, stdout: JSON.stringify({ body: prBody }), stderr: '' } }]);
  const stats = await sweepPrDescription({ $, owner: 'o', repo: 'r', prNumber: 9 });
  assert(stats.scanned === 1);
  assert(stats.edited === 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
