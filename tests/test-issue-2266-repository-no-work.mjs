#!/usr/bin/env node

/**
 * Regression coverage for issue #2266: a repository-wide solve with no open
 * issues is an informative no-op, not a failed work session.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2266
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { initI18n, preloadAllLocales, t } from '../src/i18n.lib.mjs';
import { checkRepositoryModeWork, replyIfRepositoryHasNoWork } from '../src/telegram-solve-repository-preflight.lib.mjs';

const repositoryTarget = {
  type: 'repo',
  owner: 'link-assistant',
  repo: 'router',
  canonical: 'https://github.com/link-assistant/router',
};

function issueEntry(number, { pullRequest = false } = {}) {
  return {
    id: number * 10,
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/link-assistant/router/issues/${number}`,
    created_at: `2026-09-${String(number).padStart(2, '0')}T00:00:00Z`,
    ...(pullRequest ? { pull_request: { url: `https://api.github.com/repos/link-assistant/router/pulls/${number}` } } : {}),
  };
}

function issueListRunner(entries, calls = []) {
  return async (command, args) => {
    calls.push([command, ...args]);
    return { code: 0, stdout: JSON.stringify(entries), stderr: '' };
  };
}

test('Telegram preflight classifies an empty repository as no-work', async () => {
  const calls = [];
  const result = await checkRepositoryModeWork({ parsed: repositoryTarget, run: issueListRunner([], calls) });

  assert.equal(result.applicable, true);
  assert.equal(result.noWork, true);
  assert.equal(result.totalOpen, 0);
  assert.equal(result.repository.fullName, 'link-assistant/router');
  assert.equal(calls.length, 1);
  assert.match(calls[0][2], /issues\?state=open/);
});

test('pull requests returned by the Issues API do not count as repository work', async () => {
  const result = await checkRepositoryModeWork({ parsed: repositoryTarget, run: issueListRunner([issueEntry(3, { pullRequest: true })]) });
  assert.equal(result.noWork, true);
  assert.equal(result.totalOpen, 0);
});

test('an open issue keeps the normal repository solve path active', async () => {
  const result = await checkRepositoryModeWork({ parsed: repositoryTarget, run: issueListRunner([issueEntry(4)]) });
  assert.equal(result.noWork, false);
  assert.equal(result.totalOpen, 1);
});

test('issue and pull request targets do not perform a repository query', async () => {
  let called = false;
  const result = await checkRepositoryModeWork({
    parsed: { ...repositoryTarget, type: 'issue', number: 4 },
    run: async () => {
      called = true;
      throw new Error('must not run');
    },
  });

  assert.deepEqual(result, { applicable: false, noWork: false });
  assert.equal(called, false);
});

test('Telegram sends the localized no-work response as a reply to the command', async () => {
  const replies = [];
  const handled = await replyIfRepositoryHasNoWork({
    ctx: { message: { message_id: 2266 } },
    parsed: repositoryTarget,
    locale: 'en',
    run: issueListRunner([]),
    translate: (key, values, options) => `${key}|${values.repository}|${options.locale}`,
    escape: value => `escaped:${value}`,
    reply: async (...args) => replies.push(args),
  });

  assert.equal(handled, true);
  assert.deepEqual(replies, [[{ message: { message_id: 2266 } }, 'telegram.repository_no_open_issues|escaped:link-assistant/router|en', { reply_to_message_id: 2266 }]]);
});

test('Telegram preflight failures fall through to the normal solve path', async () => {
  const errors = [];
  const handled = await replyIfRepositoryHasNoWork({
    ctx: { message: { message_id: 2266 } },
    parsed: repositoryTarget,
    locale: 'en',
    run: async () => ({ code: 1, stdout: '', stderr: 'GitHub unavailable' }),
    onError: error => errors.push(error.message),
    reply: async () => assert.fail('a failed preflight must not claim the repository is empty'),
  });

  assert.equal(handled, false);
  assert.deepEqual(errors, ['GitHub unavailable']);
});

test('Telegram answers no-work before reserving queue capacity or starting a session', async () => {
  const source = await readFile(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  const preflight = source.indexOf('const repliedNoWork = await replyIfRepositoryHasNoWork');
  const reserveSlot = source.indexOf('solveQueue.reserveStartSlot');
  const launch = source.indexOf("executeAndUpdateMessage(ctx, startingMessage, 'solve'");

  assert.ok(preflight > 0, 'repository no-work preflight must be wired into /solve');
  assert.ok(reserveSlot > preflight, 'the no-work response must happen before queue capacity is reserved');
  assert.ok(launch > preflight, 'the no-work response must happen before a work session is launched');
});

test('the CLI converts the race-safe no-work result into exit code 0', async () => {
  const source = await readFile(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  const noWorkBranch = source.indexOf('if (repositoryMode.noWork)');
  const successExit = source.indexOf('await safeExit(0,', noWorkBranch);
  const failureBranch = source.indexOf('if (repositoryMode.error)', noWorkBranch);

  assert.ok(noWorkBranch > 0, 'solve.mjs must recognize the resolver noWork result');
  assert.ok(successExit > noWorkBranch && successExit < failureBranch, 'noWork must exit successfully before the repository error branch');
});

test('the direct Telegram no-work message is available in every supported locale', async () => {
  await initI18n('en');
  await preloadAllLocales();

  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    const message = t('telegram.repository_no_open_issues', { repository: 'link-assistant/router' }, { locale });
    assert.match(message, /link-assistant\/router/);
    assert.ok(!message.includes('telegram.repository_no_open_issues'), `${locale} must resolve the translation key`);
    assert.ok(message.startsWith('ℹ️'), `${locale} must present the outcome as information`);
  }
});
