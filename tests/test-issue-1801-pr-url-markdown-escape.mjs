#!/usr/bin/env node
/**
 * Regression test for issue #1801:
 *
 *   When the upstream repository name contains an underscore (e.g.
 *   `save_visiogetbb`), the work-session completion message produced by
 *   `formatSessionCompletionMessage` was rejected by Telegram with:
 *
 *     Bad Request: can't parse entities: Can't find end of the entity
 *     starting at byte offset 318
 *
 *   The root cause was that `appendPullRequestLine` inserted the raw PR URL
 *   while the surrounding `Issue:` line had already been escaped via
 *   `escapeMarkdown` at `buildTelegramInfoBlock` time. The unbalanced
 *   underscore in the PR URL opened a Markdown italic entity that never
 *   closed, triggering the parse error.
 *
 *   Compare against the recorded production payload in
 *   `docs/case-studies/issue-1801/hive-telegram-bot.log` line 100236.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1801
 */

import { appendPullRequestLine, formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { escapeMarkdown } from '../src/telegram-markdown.lib.mjs';
import { isTelegramFormattingError, buildTelegramFormattingFallbackText, stripTelegramMarkdown } from '../src/telegram-safe-reply.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

/**
 * Lightweight Telegram legacy-Markdown parser simulator.
 * Returns null on success or an error string mirroring Telegram's wording.
 * Mirrors the approach used by tests/test-telegram-safe-reply-issue-1497.mjs.
 */
function checkTelegramMarkdown(text) {
  let i = 0;
  const len = text.length;
  const open = [];
  while (i < len) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < len && '_*`['.includes(text[i + 1])) {
      i += 2;
      continue;
    }
    if (ch === '`') {
      const triple = text.substring(i, i + 3) === '```';
      if (triple) {
        const end = text.indexOf('```', i + 3);
        if (end === -1) return `Unclosed code block starting at byte ${Buffer.byteLength(text.substring(0, i))}`;
        i = end + 3;
        continue;
      }
      const end = text.indexOf('`', i + 1);
      if (end === -1) return `Unclosed inline code starting at byte ${Buffer.byteLength(text.substring(0, i))}`;
      i = end + 1;
      continue;
    }
    if (ch === '[') {
      const cb = text.indexOf(']', i + 1);
      if (cb !== -1 && text[cb + 1] === '(') {
        const cp = text.indexOf(')', cb + 2);
        if (cp !== -1) {
          i = cp + 1;
          continue;
        }
      }
    }
    if (ch === '_' || ch === '*') {
      const last = open.length > 0 ? open[open.length - 1] : null;
      if (last && last.char === ch) open.pop();
      else open.push({ char: ch, byte: Buffer.byteLength(text.substring(0, i)) });
    }
    i++;
  }
  if (open.length > 0) {
    const first = open[0];
    return `can't parse entities: Can't find end of the entity starting at byte offset ${first.byte}`;
  }
  return null;
}

console.log('Testing issue #1801: PR URL markdown escaping prevents parse errors');
console.log('='.repeat(60));

// -- The exact payload from the bug report --
console.log('\n  Reproducing the exact production payload:');
{
  // This Issue line is what `buildTelegramInfoBlock` produces when the
  //   /solve URL points at https://github.com/Surrogate-TM/save_visiogetbb/issues/7.
  //   Underscores are already escaped because telegram-bot.mjs passes the
  //   issue URL through escapeMarkdown.
  const escapedIssueUrl = escapeMarkdown('https://github.com/Surrogate-TM/save_visiogetbb/issues/7');
  const infoBlock = 'Requested by: [@surrogate\\_tm](https://t.me/surrogate_tm)' + `\nIssue: ${escapedIssueUrl}` + '\n\n🛠 Options: --tool claude' + '\n🔒 Locked options: --attach-logs --verbose --no-tool-check --disable-report-issue';

  // Bug repro: appending the *unescaped* PR URL re-introduces a bare underscore.
  const pullRequestUrl = 'https://github.com/Surrogate-TM/save_visiogetbb/pull/8';
  const out = appendPullRequestLine(infoBlock, pullRequestUrl);

  // The fix guarantees the PR URL is escaped exactly like the Issue URL.
  assert(out.includes('Pull request: https://github.com/Surrogate-TM/save\\_visiogetbb/pull/8'), 'Pull request URL underscores are backslash-escaped');
  assert(!/Pull request: https:\/\/github\.com\/Surrogate-TM\/save_visiogetbb/.test(out), 'No bare underscore in the appended PR URL');

  // Confirm there are no bare underscores anywhere in the appended PR line.
  //   (Production error byte offset 318 fell exactly on an unescaped `_`.)
  const prLine = out.split('\n').find(l => l.startsWith('Pull request: '));
  assert(prLine && !/(?<!\\)_/.test(prLine), 'Appended PR line has zero bare underscores');
}

// -- Full completion message also has the escape --
console.log('\n  Full completion message escapes the PR URL underscore:');
{
  const escapedIssueUrl = escapeMarkdown('https://github.com/Surrogate-TM/save_visiogetbb/issues/7');
  const infoBlock = 'Requested by: [@surrogate\\_tm](https://t.me/surrogate_tm)' + `\nIssue: ${escapedIssueUrl}` + '\n\n🛠 Options: --tool claude' + '\n🔒 Locked options: --attach-logs --verbose --no-tool-check --disable-report-issue';

  const message = formatSessionCompletionMessage({
    sessionName: '58f142b8-344f-44bf-9054-7a648e7212b8',
    sessionInfo: {
      isolationBackend: 'screen',
      startTime: new Date('2026-05-14T20:00:00.000Z'),
    },
    statusResult: {
      status: 'executed',
      exitCode: 0,
      startTime: '2026-05-14T20:00:00.000Z',
      endTime: '2026-05-14T20:09:21.000Z',
    },
    infoBlock,
    pullRequestUrl: 'https://github.com/Surrogate-TM/save_visiogetbb/pull/8',
  });

  assert(message.includes('Pull request: https://github.com/Surrogate-TM/save\\_visiogetbb/pull/8'), 'Completion message contains escaped PR URL');
  assert(!/Pull request: https:\/\/github\.com\/Surrogate-TM\/save_visiogetbb/.test(message), 'Completion message has no bare-underscore PR URL');
  assert(message.includes('Issue: https://github.com/Surrogate-TM/save\\_visiogetbb/issues/7'), 'Completion message keeps escaped Issue URL');

  // Sanity: outside of Markdown link URLs, every `_` must be escaped. Strip
  //   the `(url)` portions of [text](url) links (Telegram treats those as
  //   opaque) and then ensure no bare underscores remain.
  const withoutLinkUrls = message.replace(/\]\([^)]*\)/g, ']()');
  const bareUnderscores = [...withoutLinkUrls.matchAll(/(?<!\\)_/g)].length;
  assert(bareUnderscores === 0, `No bare underscores outside markdown link URLs (count=${bareUnderscores})`);
}

// -- Idempotency still works after the escape fix --
console.log('\n  Idempotency: re-appending the same PR URL is a no-op:');
{
  const escapedIssueUrl = escapeMarkdown('https://github.com/Surrogate-TM/save_visiogetbb/issues/7');
  const infoBlock = `Requested by: @alice\nIssue: ${escapedIssueUrl}`;
  const pullRequestUrl = 'https://github.com/Surrogate-TM/save_visiogetbb/pull/8';
  const once = appendPullRequestLine(infoBlock, pullRequestUrl);
  const twice = appendPullRequestLine(once, pullRequestUrl);
  assert(once === twice, 'Calling appendPullRequestLine twice with the same raw URL is a no-op (idempotent)');
  // Also idempotent when caller passes the escaped form (defensive)
  const thrice = appendPullRequestLine(once, escapeMarkdown(pullRequestUrl));
  assert(once === thrice, 'Idempotent even when caller supplies an already-escaped URL');
}

// -- isTelegramFormattingError covers the production error string --
console.log('\n  Detection of the exact production error message:');
{
  const productionError = {
    description: "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 318",
  };
  assert(isTelegramFormattingError(productionError), 'isTelegramFormattingError detects the exact production payload');
}

// -- Fallback strips the markdown so plain-text retry is clean --
console.log('\n  Plain-text fallback preserves the user-facing URL:');
{
  // Even if a bug ever produced an unbalanced entity again, the fallback path
  //   should still produce readable text containing the PR URL.
  const text = '✅ *Work session finished successfully*\n\nPull request: https://github.com/Surrogate-TM/save_visiogetbb/pull/8';
  const fallback = buildTelegramFormattingFallbackText(text, { fallbackLocale: 'en' });
  assert(fallback.includes('Pull request: https://github.com/Surrogate-TM/save_visiogetbb/pull/8'), 'Fallback retains the raw PR URL for the user');
  assert(!fallback.includes('*Work session finished successfully*'), 'Fallback strips the bold markers');
}

// -- Simulator reproduces the production parse error before the fix --
console.log('\n  Simulator reproduces and then resolves the production error:');
{
  const escapedIssueUrl = escapeMarkdown('https://github.com/Surrogate-TM/save_visiogetbb/issues/7');
  const infoBlock = 'Requested by: [@surrogate\\_tm](https://t.me/surrogate_tm)' + `\nIssue: ${escapedIssueUrl}` + '\n\n🛠 Options: --tool claude' + '\n🔒 Locked options: --attach-logs --verbose --no-tool-check --disable-report-issue';

  // Pre-fix behavior reproduction: hand-build the broken PR line.
  const brokenInfoBlock = infoBlock.replace(`Issue: ${escapedIssueUrl}`, `Issue: ${escapedIssueUrl}\nPull request: https://github.com/Surrogate-TM/save_visiogetbb/pull/8`);
  const brokenMessage = '✅ *Work session finished successfully*\n\n' + '⏱️ Duration: 9m 21s\n' + '📊 Session: `58f142b8-344f-44bf-9054-7a648e7212b8`\n' + '🔒 Isolation: `screen`\n\n' + brokenInfoBlock;
  const brokenError = checkTelegramMarkdown(brokenMessage);
  assert(brokenError !== null && /byte offset 318/.test(brokenError), `Pre-fix payload reproduces "byte offset 318" parse error (got: ${brokenError})`);

  // Post-fix behavior: build via the real code path.
  const fixedMessage = formatSessionCompletionMessage({
    sessionName: '58f142b8-344f-44bf-9054-7a648e7212b8',
    sessionInfo: {
      isolationBackend: 'screen',
      startTime: new Date('2026-05-14T20:00:00.000Z'),
    },
    statusResult: {
      status: 'executed',
      exitCode: 0,
      startTime: '2026-05-14T20:00:00.000Z',
      endTime: '2026-05-14T20:09:21.000Z',
    },
    infoBlock,
    pullRequestUrl: 'https://github.com/Surrogate-TM/save_visiogetbb/pull/8',
  });
  const fixedError = checkTelegramMarkdown(fixedMessage);
  assert(fixedError === null, `Post-fix payload passes Markdown parsing (error: ${fixedError})`);
}

// -- Verbose logging captures original + fallback + byte-offset context --
console.log('\n  Verbose logging surfaces original + fallback + byte-offset context:');
{
  // Import here to keep top-of-file imports tidy.
  const { installTelegramFormattingFallback } = await import('../src/telegram-safe-reply.lib.mjs');

  const logged = [];
  const originalError = console.error;
  console.error = (...args) => {
    logged.push(args.join(' '));
  };

  try {
    let callCount = 0;
    const fakeTelegram = {
      editMessageText: async (_chatId, _msgId, _inline, text, options) => {
        callCount += 1;
        if (callCount === 1) {
          const err = new Error("Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 318");
          err.description = "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 318";
          throw err;
        }
        return { text, options };
      },
    };
    installTelegramFormattingFallback(fakeTelegram, { verbose: true, fallbackLocale: 'en' });

    const failingText = '✅ *Work session finished successfully*\n\nPull request: https://github.com/Surrogate-TM/save_visiogetbb/pull/8';
    await fakeTelegram.editMessageText(1, 2, undefined, failingText, { parse_mode: 'Markdown' });

    const joined = logged.join('\n');
    assert(/Failing message \(\d+ bytes\)/.test(joined), 'Verbose log includes failing message with byte count');
    assert(/Byte offset 318 context/.test(joined), 'Verbose log includes byte-offset context window');
    assert(/Fallback message \(\d+ bytes\)/.test(joined), 'Verbose log includes the fallback message with byte count');
    assert(callCount === 2, 'Wrapped method retried with the fallback text');
  } finally {
    console.error = originalError;
  }
}

// -- stripTelegramMarkdown removes the backslash escapes too --
console.log('\n  stripTelegramMarkdown unescapes backslash-escaped underscores:');
{
  const escaped = 'Pull request: https://github.com/Surrogate-TM/save\\_visiogetbb/pull/8';
  const stripped = stripTelegramMarkdown(escaped);
  assert(stripped === 'Pull request: https://github.com/Surrogate-TM/save_visiogetbb/pull/8', 'Fallback presents the human-readable URL');
}

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
