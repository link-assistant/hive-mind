#!/usr/bin/env node
/**
 * Issue #4067: a /solve, /claude or /codex command that is a reply to a message
 * with many GitHub links (or that lists them itself) starts every valid link as
 * its own task, one at a time with a random 10–15 second pause, and answers with
 * one summary of the links that were not started after all valid ones started.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseGitHubUrl } from '../src/github.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { mentionsGitHubHost } from '../src/telegram-message-filters.lib.mjs';
import { cleanNonPrintableChars } from '../src/telegram-markdown.lib.mjs';
import { parseCommandArgs } from '../src/telegram-solve-command.lib.mjs';
import { describeInvalidBatchLink, extractGitHubTargetLinks, getReplyLinkText, pickSolveBatchDelayMs, planSolveTargets, runSolveBatch, SOLVE_BATCH_DELAY_MAX_MS, SOLVE_BATCH_DELAY_MIN_MS, SOLVE_REJECT_SCOPE, summarizeRejection } from '../src/telegram-solve-batch.lib.mjs';
import { validateTelegramGitHubUrl } from '../src/telegram-url-validation.lib.mjs';

await initI18n('en');

const deps = { parseGitHubUrl, cleanNonPrintableChars, mentionsGitHubHost };

// The 25 links of the replied message in the issue #4067 screenshot.
const SCREENSHOT_LINKS = [
  'https://github.com/link-assistant/legal/issues/5',
  'https://github.com/link-assistant/image-to-number/issues/4',
  'https://github.com/link-assistant/trader-bot/issues/12',
  'https://github.com/link-assistant/web-capture/issues/190',
  'https://github.com/link-foundation/gh-download-gist/issues/3',
  'https://github.com/link-foundation/gh-upload-image/issues/3',
  'https://github.com/link-foundation/set-process-name/issues/3',
  'https://github.com/link-foundation/lino-cache/issues/5',
  'https://github.com/link-foundation/lino-objects-codec/issues/88',
  'https://github.com/link-foundation/links-client/issues/26',
  'https://github.com/link-foundation/links-queue/issues/55',
  'https://github.com/link-foundation/linksql/issues/4',
  'https://github.com/link-foundation/linksql/issues/5',
  'https://github.com/link-foundation/meta-notation/issues/5',
  'https://github.com/link-foundation/meta-ontology/issues/8',
  'https://github.com/link-foundation/relative-meta-logic/issues/189',
  'https://github.com/link-foundation/relative-meta-logic/issues/188',
  'https://github.com/link-foundation/rust-web-box/issues/46',
  'https://github.com/link-foundation/universal-translator/issues/2',
  'https://github.com/link-foundation/use-m/issues/88',
  'https://github.com/link-foundation/link-cli/issues/181',
  'https://github.com/link-foundation/gh-uncommitted/issues/3',
  'https://github.com/linksplatform/doublets-rs/issues/92',
  'https://github.com/linksplatform/doublets-web/issues/34',
  'https://github.com/linksplatform/doublets-web/pull/35',
];

const reply = text => ({ message_id: 7, text });

test('the screenshot reply is a batch of 25 links with the command options', () => {
  const userArgs = parseCommandArgs('/codex —think medium —auto-merge');
  const plan = planSolveTargets({ userArgs, commandHasUrl: false, replyMessage: reply(SCREENSHOT_LINKS.join('\n')), deps });
  assert.equal(plan.mode, 'batch');
  assert.equal(plan.fromReply, true);
  assert.deepEqual(plan.urls, SCREENSHOT_LINKS);
  assert.deepEqual(plan.invalidLinks, []);
  assert.deepEqual(plan.optionArgs, ['--think', 'medium', '--auto-merge']);
});

test('one link in the reply keeps the single-link flow (issue #1325)', () => {
  const plan = planSolveTargets({ userArgs: ['--model', 'opus'], commandHasUrl: false, replyMessage: reply('see https://github.com/o/r/issues/1 and https://github.com/o/r'), deps });
  assert.deepEqual(plan, { mode: 'single', userArgs: ['https://github.com/o/r/issues/1', '--model', 'opus'], fromReply: true });
});

test('a reply without issue or pull request links is still answered with the no-link error', () => {
  assert.deepEqual(planSolveTargets({ userArgs: [], commandHasUrl: false, replyMessage: reply('no links here, only github.com'), deps }), { mode: 'no-link' });
});

test('a command that is not a reply and names one link is unchanged', () => {
  const userArgs = ['https://github.com/o/r/issues/1', '--model', 'opus'];
  assert.deepEqual(planSolveTargets({ userArgs, commandHasUrl: true, replyMessage: null, deps }), { mode: 'single', userArgs, fromReply: false });
});

test('several links in the command itself are a batch too', () => {
  const userArgs = parseCommandArgs('/solve https://github.com/o/r/issues/1 https://github.com/o/r/pull/2 https://github.com/o/r/issues/x --model opus');
  const plan = planSolveTargets({ userArgs, commandHasUrl: true, replyMessage: reply('https://github.com/o/r/issues/9'), deps });
  assert.equal(plan.mode, 'batch');
  assert.deepEqual(plan.urls, ['https://github.com/o/r/issues/1', 'https://github.com/o/r/pull/2']);
  assert.deepEqual(plan.invalidLinks, ['https://github.com/o/r/issues/x']);
  assert.deepEqual(plan.optionArgs, ['--model', 'opus']);
});

test('links are deduplicated in order, and other GitHub links are kept as invalid', () => {
  const found = extractGitHubTargetLinks('https://github.com/o/r/issues/1 https://github.com/o/r/issues/2 https://github.com/o/r/issues/1 https://github.com/o/r https://github.com/o/r/issues/abc github.com mentioned', deps);
  assert.deepEqual(found.urls, ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2']);
  assert.deepEqual(found.duplicates, ['https://github.com/o/r/issues/1']);
  assert.deepEqual(found.invalidLinks, ['https://github.com/o/r', 'https://github.com/o/r/issues/abc']);
});

test('hidden links (text_link entities) and captions are read from the replied message', () => {
  const message = { message_id: 1, caption: 'Fix https://github.com/o/r/issues/1', caption_entities: [{ type: 'text_link', offset: 0, length: 3, url: 'https://github.com/o/r/issues/2' }] };
  assert.equal(getReplyLinkText(message), 'Fix https://github.com/o/r/issues/1\nhttps://github.com/o/r/issues/2');
  const plan = planSolveTargets({ userArgs: [], commandHasUrl: false, replyMessage: message, deps });
  assert.deepEqual(plan.urls, ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2']);
});

test('the pause between two starts is between 10 and 15 seconds', () => {
  assert.equal(SOLVE_BATCH_DELAY_MIN_MS, 10_000);
  assert.equal(SOLVE_BATCH_DELAY_MAX_MS, 15_000);
  assert.equal(pickSolveBatchDelayMs({ random: () => 0 }), 10_000);
  assert.equal(pickSolveBatchDelayMs({ random: () => 0.999999 }), 15_000);
  for (let i = 0; i < 200; i++) {
    const delay = pickSolveBatchDelayMs();
    assert.ok(delay >= 10_000 && delay <= 15_000, `delay ${delay}`);
  }
});

/** A fake single-link flow: links in `failing` are rejected like the bot rejects them. */
function createHarness({ failing = {}, optionsError = null } = {}) {
  const events = [];
  const launch = async (args, reject) => {
    const url = args[0];
    events.push({ type: 'launch', url, args });
    if (optionsError) return reject(`❌ ${optionsError}\n\nUse /help to see available options`, { scope: SOLVE_REJECT_SCOPE.OPTIONS });
    if (failing[url]) return reject(`❌ ${failing[url]}\n\n📍 Location details`);
    events.push({ type: 'reply', text: `🚀 Starting ${url}` });
    return { started: true };
  };
  return {
    events,
    launch,
    reply: async text => events.push({ type: 'reply', text }),
    sleep: async ms => events.push({ type: 'sleep', ms }),
    validateLink: link => describeInvalidBatchLink(link, { parseGitHubUrl, validateUrl: url => validateTelegramGitHubUrl(url) }),
  };
}

test('valid links start one by one with a pause, the invalid ones are summarized at the end', async () => {
  const urls = ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2', 'https://github.com/o/r/issues/3', 'https://github.com/o/r/issues/4'];
  const harness = createHarness({ failing: { 'https://github.com/o/r/issues/2': 'Issue #2 not found' } });
  const result = await runSolveBatch({ urls, invalidLinks: ['https://github.com/o/r'], optionArgs: ['--think', 'medium'], ...harness, pickDelayMs: () => 12_345 });

  assert.deepEqual(result.started, ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/3', 'https://github.com/o/r/issues/4']);
  assert.deepEqual(
    harness.events.map(event => (event.type === 'reply' ? `reply:${event.text.split('\n')[0]}` : `${event.type}:${event.url || event.ms}`)),
    ['launch:https://github.com/o/r/issues/1', 'reply:🚀 Starting https://github.com/o/r/issues/1', 'sleep:12345', 'launch:https://github.com/o/r/issues/2', 'launch:https://github.com/o/r/issues/3', 'reply:🚀 Starting https://github.com/o/r/issues/3', 'sleep:12345', 'launch:https://github.com/o/r/issues/4', 'reply:🚀 Starting https://github.com/o/r/issues/4', 'reply:📋 3 of 5 links started. Not started (2):']
  );
  assert.deepEqual(harness.events[0].args, ['https://github.com/o/r/issues/1', '--think', 'medium']);
  const summary = harness.events.at(-1).text;
  assert.ok(summary.includes('1. https://github.com/o/r/issues/2 — Issue #2 not found'), summary);
  assert.ok(summary.includes('2. https://github.com/o/r — repository links are not started from a list of links'), summary);
  assert.doesNotMatch(summary, /Location details/);
  assert.equal(result.summary, summary);
});

test('no summary when every link started, and no pause after the last one', async () => {
  const harness = createHarness();
  const result = await runSolveBatch({ urls: ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2'], optionArgs: [], ...harness, pickDelayMs: () => 10_000 });
  assert.equal(result.summary, null);
  assert.deepEqual(
    harness.events.map(event => event.type),
    ['launch', 'reply', 'sleep', 'launch', 'reply']
  );
});

test('an options error is answered once and starts nothing', async () => {
  const harness = createHarness({ optionsError: 'Unknown argument: --bogus' });
  const result = await runSolveBatch({ urls: ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2'], invalidLinks: ['https://github.com/o/r'], optionArgs: ['--bogus'], ...harness });
  assert.deepEqual(result.started, []);
  assert.match(result.optionsError, /Unknown argument/);
  assert.deepEqual(
    harness.events.map(event => event.type),
    ['launch', 'reply']
  );
});

test('a chat stopped during the batch leaves the rest unstarted, listed in the summary', async () => {
  const harness = createHarness();
  let stopped = false;
  const sleep = async ms => {
    harness.events.push({ type: 'sleep', ms });
    stopped = true;
  };
  const result = await runSolveBatch({ urls: ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2', 'https://github.com/o/r/issues/3'], optionArgs: [], ...harness, sleep, isStopped: () => stopped });
  assert.deepEqual(result.started, ['https://github.com/o/r/issues/1']);
  assert.deepEqual(
    result.notStarted.map(entry => entry.url),
    ['https://github.com/o/r/issues/2', 'https://github.com/o/r/issues/3']
  );
  assert.match(result.summary, /the chat was stopped before this link was started/);
});

test('a link whose launch throws is listed in the summary, and the next link still starts', async () => {
  const harness = createHarness();
  const launch = async (args, reject) => {
    if (args[0].endsWith('/1')) throw new Error('GitHub API is down');
    return harness.launch(args, reject);
  };
  const result = await runSolveBatch({ urls: ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2'], optionArgs: [], ...harness, launch });
  assert.deepEqual(result.started, ['https://github.com/o/r/issues/2']);
  assert.ok(result.summary.includes('1. https://github.com/o/r/issues/1 — the start failed: GitHub API is down'), result.summary);
});

test('summary reasons for links that are not issue or pull request links', () => {
  const validateUrl = url => validateTelegramGitHubUrl(url);
  assert.match(describeInvalidBatchLink('https://github.com/o/r', { parseGitHubUrl, validateUrl }), /send `\/solve <repository-url>` alone/);
  const reason = describeInvalidBatchLink('https://github.com/o/r/issues/abc', { parseGitHubUrl, validateUrl });
  assert.ok(reason.length > 1 && !reason.startsWith('❌'), reason);
  assert.equal(summarizeRejection('❌ Bad link\n\n📍 Location'), 'Bad link');
  assert.equal(summarizeRejection(''), '—');
});

test('the summary is translated', async () => {
  const harness = createHarness({ failing: { 'https://github.com/o/r/issues/2': 'nope' } });
  const result = await runSolveBatch({ urls: ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2'], optionArgs: [], ...harness, sleep: async () => {}, locale: 'ru' });
  assert.match(result.summary, /Запущено ссылок: 1 из 2/);
});

test('the bot routes /solve through the batch planner instead of refusing several links', async () => {
  const source = await readFile(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  assert.match(source, /planSolveTargets\(/);
  assert.match(source, /runSolveBatch\(/);
  assert.match(source, /async function launchSolveTarget\(ctx, userArgs, \{[^}]*reject = null \}\)/);
  assert.doesNotMatch(source, /_extractGitHubUrl\(/);
});
