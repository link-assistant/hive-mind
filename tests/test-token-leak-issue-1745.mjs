#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression test for issue #1745 — Telegram bot token leak via interactive
 * mode `Bash` tool output.
 *
 * Reproduces the exact leak shape from xlab2016/space_db_private#20:
 *   1. The agent ran a bash command whose stdout contained
 *      TELEGRAM_BOT_TOKEN=<value>.
 *   2. interactive-mode.lib.mjs#editComment posted that stdout verbatim
 *      into a public PR comment.
 *
 * The test:
 *   - constructs a tool-result-style comment body containing a known-local
 *     token (set via process.env.TELEGRAM_BOT_TOKEN for the duration of the
 *     test);
 *   - calls sanitizeCommentBody() — the function newly invoked from
 *     postComment/editComment;
 *   - asserts the raw token is gone, the masked form (3-char prefix + ***
 *     + 3-char suffix) is present, and containsKnownToken() reports a hit.
 *
 * @see docs/case-studies/issue-1745/analysis.md
 */

import { containsKnownToken, getAllKnownLocalTokens, getEnvironmentTokens, KNOWN_LOCAL_TOKEN_ENV_VARS, sanitizeCommentBody, sanitizeLogContent, sanitizeOutput } from '../src/token-sanitization.lib.mjs';
import { maskToken } from '../src/lib.mjs';
import { reportInteractiveLeak, registerLeakNotifier, clearLeakNotifierForTests } from '../src/telegram-leak-notifier.lib.mjs';
import { formatTokenList } from '../src/telegram-tokens-command.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

const runAsyncTest = async (name, fn) => {
  process.stdout.write(`Testing ${name}... `);
  try {
    await fn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
    testsFailed++;
  }
};

const runTest = (name, fn) => {
  process.stdout.write(`Testing ${name}... `);
  try {
    fn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
    testsFailed++;
  }
};

const assert = (cond, message) => {
  if (!cond) throw new Error(message || 'assertion failed');
};

const assertContains = (str, sub, message = '') => {
  if (!str.includes(sub)) {
    throw new Error(`${message}\n  expected to contain: ${JSON.stringify(sub)}\n  actual: ${JSON.stringify(str.slice(0, 200))}`);
  }
};

const assertNotContains = (str, sub, message = '') => {
  if (str.includes(sub)) {
    throw new Error(`${message}\n  expected NOT to contain: ${JSON.stringify(sub)}\n  actual: ${JSON.stringify(str.slice(0, 200))}`);
  }
};

console.log('🧪 Issue #1745 regression: Telegram bot token leak via Bash tool comment\n');

// Issue #1745 leak shape — synthetic token built at runtime so this file does
// not itself trip secret-scanners. Same shape as the leaked one (digits :
// 30+ base64-ish chars).
const SYNTHETIC_BOT_TOKEN = ['8490528355', ':', 'AAGHe', 'NpjZJqWEytzt4iw1kfW2ouXly', 'ItTEST'].join('');

// Snapshot existing env so we can restore it.
const ORIGINAL_TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

await runAsyncTest('sanitizeCommentBody masks env-injected TELEGRAM_BOT_TOKEN', async () => {
  process.env.TELEGRAM_BOT_TOKEN = SYNTHETIC_BOT_TOKEN;
  try {
    // This is exactly the comment body shape that leaked in
    // xlab2016/space_db_private#20 — `env` output captured by the Bash tool
    // and embedded in a fenced code block by interactive-mode.lib.mjs.
    const leakedBody = ['## 🛠️ Bash tool use', '', '```bash', 'env', '```', '', '<details><summary>📤 Output</summary>', '', '```', 'PATH=/usr/bin:/bin', `TELEGRAM_BOT_TOKEN=${SYNTHETIC_BOT_TOKEN}`, 'HOME=/home/user', '```', '', '</details>'].join('\n');

    const sanitized = await sanitizeCommentBody(leakedBody);

    assertNotContains(sanitized, SYNTHETIC_BOT_TOKEN, 'Raw token MUST NOT survive sanitization');
    assertContains(sanitized, maskToken(SYNTHETIC_BOT_TOKEN), 'Masked form must appear');
    // The masked form keeps first-3 + last-3 per the new default.
    assertContains(maskToken(SYNTHETIC_BOT_TOKEN), '849', 'first 3 chars preserved');
    assertContains(maskToken(SYNTHETIC_BOT_TOKEN), 'EST', 'last 3 chars preserved');
    assertContains(maskToken(SYNTHETIC_BOT_TOKEN), '*', 'asterisks present');
  } finally {
    if (ORIGINAL_TELEGRAM_BOT_TOKEN === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
    }
  }
});

await runAsyncTest('sanitizeOutput is the canonical sanitizer and sanitizeLogContent remains compatible', async () => {
  const text = `token=${SYNTHETIC_BOT_TOKEN}`;
  const sanitizedOutput = await sanitizeOutput(text);
  const sanitizedLog = await sanitizeLogContent(text);
  assertNotContains(sanitizedOutput, SYNTHETIC_BOT_TOKEN, 'sanitizeOutput must mask token-shaped output');
  assertContains(sanitizedOutput, maskToken(SYNTHETIC_BOT_TOKEN), 'sanitizeOutput should preserve masked comparison form');
  assert(sanitizedOutput === sanitizedLog, 'sanitizeLogContent alias should match sanitizeOutput');
});

await runAsyncTest('dangerous pattern skip still keeps active local token masking enabled', async () => {
  process.env.TELEGRAM_BOT_TOKEN = SYNTHETIC_BOT_TOKEN;
  try {
    const body = `active=${SYNTHETIC_BOT_TOKEN}`;
    const sanitized = await sanitizeCommentBody(body, { skipOutputSanitization: true });
    assertNotContains(sanitized, SYNTHETIC_BOT_TOKEN, 'active token must still be masked when only pattern sanitization is skipped');
    assertContains(sanitized, maskToken(SYNTHETIC_BOT_TOKEN), 'masked active token must remain visible for comparison');
  } finally {
    if (ORIGINAL_TELEGRAM_BOT_TOKEN === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
    }
  }
});

await runAsyncTest('active-token skip is separate and explicit', async () => {
  process.env.TELEGRAM_BOT_TOKEN = SYNTHETIC_BOT_TOKEN;
  try {
    const inertActiveToken = ['active-token-value-', '12345678901234567890'].join('');
    process.env.TELEGRAM_BOT_TOKEN = inertActiveToken;
    const body = `active=${inertActiveToken}`;
    const sanitized = await sanitizeCommentBody(body, {
      skipOutputSanitization: true,
      skipActiveTokensOutputSanitization: true,
    });
    assertContains(sanitized, inertActiveToken, 'active token survives only when active-token sanitization is explicitly skipped too');
  } finally {
    if (ORIGINAL_TELEGRAM_BOT_TOKEN === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
    }
  }
});

await runAsyncTest('containsKnownToken reports the env hit', async () => {
  process.env.TELEGRAM_BOT_TOKEN = SYNTHETIC_BOT_TOKEN;
  try {
    const body = `Some text TELEGRAM_BOT_TOKEN=${SYNTHETIC_BOT_TOKEN} more text`;
    const hits = await containsKnownToken(body);
    assert(hits.length >= 1, 'should report at least one known-token hit');
    assert(
      hits.some(h => h.source === 'env'),
      'one hit should be from env'
    );
  } finally {
    if (ORIGINAL_TELEGRAM_BOT_TOKEN === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
    }
  }
});

await runAsyncTest('getEnvironmentTokens picks up TELEGRAM_BOT_TOKEN', async () => {
  process.env.TELEGRAM_BOT_TOKEN = SYNTHETIC_BOT_TOKEN;
  try {
    const tokens = getEnvironmentTokens();
    const telegram = tokens.find(t => t.name === 'TELEGRAM_BOT_TOKEN');
    assert(telegram !== undefined, 'TELEGRAM_BOT_TOKEN should be returned');
    assert(telegram.value === SYNTHETIC_BOT_TOKEN, 'value should match env');
  } finally {
    if (ORIGINAL_TELEGRAM_BOT_TOKEN === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
    }
  }
});

await runAsyncTest('getAllKnownLocalTokens deduplicates by value', async () => {
  process.env.TELEGRAM_BOT_TOKEN = SYNTHETIC_BOT_TOKEN;
  try {
    const tokens = await getAllKnownLocalTokens();
    const matching = tokens.filter(t => t.value === SYNTHETIC_BOT_TOKEN);
    assert(matching.length === 1, `expected exactly one entry for the token, got ${matching.length}`);
  } finally {
    if (ORIGINAL_TELEGRAM_BOT_TOKEN === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
    }
  }
});

runTest('maskToken default is 3+3 chars (issue #1745 spec)', () => {
  const t = 'ghp_1234567890abcdef1234567890abcdef12345678';
  const masked = maskToken(t);
  assertContains(masked, 'ghp', 'first 3 chars preserved');
  assertContains(masked, '678', 'last 3 chars preserved');
  // First 5 chars should NOT be all preserved together (e.g. 'ghp_1' is 5).
  // The mask should now be 'ghp***...***678' rather than 'ghp_1***...*5678'.
  assert(!masked.startsWith('ghp_1'), 'must not preserve first 5 chars (3-char default)');
});

runTest('KNOWN_LOCAL_TOKEN_ENV_VARS covers required tools', () => {
  const required = ['TELEGRAM_BOT_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENCODE_API_KEY', 'GEMINI_API_KEY', 'QWEN_API_KEY'];
  for (const name of required) {
    assert(KNOWN_LOCAL_TOKEN_ENV_VARS.includes(name), `KNOWN_LOCAL_TOKEN_ENV_VARS must include ${name}`);
  }
});

await runAsyncTest('reportInteractiveLeak fires the registered notifier', async () => {
  let received = null;
  registerLeakNotifier(async payload => {
    received = payload;
  });
  try {
    await reportInteractiveLeak({
      owner: 'xlab2016',
      repo: 'space_db_private',
      prNumber: 20,
      tokenHits: [{ name: 'TELEGRAM_BOT_TOKEN', source: 'env' }],
      log: async () => {},
    });
    assert(received !== null, 'notifier was called');
    assert(received.prNumber === 20, 'PR number forwarded');
    assert(Array.isArray(received.tokenHits), 'tokenHits forwarded');
    assert(received.tokenHits[0].name === 'TELEGRAM_BOT_TOKEN', 'token name forwarded');
  } finally {
    clearLeakNotifierForTests();
  }
});

await runAsyncTest('reportInteractiveLeak degrades gracefully without notifier', async () => {
  clearLeakNotifierForTests();
  let logged = '';
  await reportInteractiveLeak({
    owner: 'x',
    repo: 'y',
    prNumber: 1,
    tokenHits: [{ name: 'TELEGRAM_BOT_TOKEN', source: 'env' }],
    log: async msg => {
      logged += msg + '\n';
    },
  });
  assertContains(logged, 'Token-leak event', 'fallback logger must be called');
});

runTest('formatTokenList produces masked output only', () => {
  const tokens = [{ source: 'env', name: 'TELEGRAM_BOT_TOKEN', value: SYNTHETIC_BOT_TOKEN }];
  const formatted = formatTokenList(tokens);
  assertNotContains(formatted, SYNTHETIC_BOT_TOKEN, 'raw token must not appear in /tokens output');
  assertContains(formatted, maskToken(SYNTHETIC_BOT_TOKEN), 'masked token must appear');
  assertContains(formatted, 'TELEGRAM_BOT_TOKEN', 'env-var name must appear');
});

runTest('formatTokenList handles empty list', () => {
  const formatted = formatTokenList([]);
  assertContains(formatted, 'No known local tokens', 'should report empty state');
});

console.log('\n' + '='.repeat(80));
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);

if (testsFailed > 0) {
  process.exit(1);
}
