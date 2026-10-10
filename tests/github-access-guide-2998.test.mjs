#!/usr/bin/env node
/**
 * Issue #2998: when Hive Mind cannot see or push to a repository, the message
 * names the account to invite, links the repository's access settings, links
 * the GitHub Docs section in the reader's language, asks for the Write role and
 * points at the visual guide.
 *
 * The original report: `/solve` on a private repository replied with generic
 * "Please check" bullets and nothing about whom to invite or how.
 *
 * Run with: node tests/github-access-guide-2998.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAccessGuidePageUrl, buildGrantWriteAccessLines, buildRepositoryNotAccessibleMessage, buildWriteAccessRequiredMessage, getAuthenticatedGitHubLogin, resetAuthenticatedGitHubLoginCache, resolveAccessGuideLocales, resolveDocsLocaleFromTelegramCtx } from '../src/github-access-guide.lib.mjs';
import { resetDefaultGitHubDocsLocale, setDefaultGitHubDocsLocale } from '../src/github-docs-links.lib.mjs';
import { clearUserLocale, setUserLocale } from '../src/i18n.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    resetDefaultGitHubDocsLocale();
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

// Exact URLs in a text (CodeQL flags substring checks of URLs).
const urlsIn = text => new Set(String(text).match(/https:\/\/[^\s)<>`'"\]]+/g) || []);

const INVITE_DOCS_PATH = '/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository#inviting-a-collaborator-to-a-personal-repository';
const ORG_DOCS_PATH = '/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-teams-and-people-with-access-to-your-repository';

await test('the reported case (personal repository, Russian reader) gets the Russian invitation docs and the account to invite', async () => {
  const message = await buildRepositoryNotAccessibleMessage({ owner: 'konard', repo: 'private-repo', autoAcceptInvite: true, botLogin: 'hive-bot', ownerType: 'User', locale: 'ru' });
  assert.ok(message.includes(`https://docs.github.com/ru${INVITE_DOCS_PATH}`), message);
  assert.ok(urlsIn(message).has('https://github.com/konard/private-repo/settings/access'), message);
  assert.ok(message.includes('`hive-bot`'), message);
  assert.ok(urlsIn(message).has('https://github.com/link-assistant/hive-mind/blob/main/docs/GITHUB-ACCESS.ru.md'), message);
  assert.ok(!message.includes(ORG_DOCS_PATH), 'personal owners do not get organization docs');
  assert.ok(!message.includes('--auto-accept-invite'), 'no flag hint when invitations are accepted automatically');
});

await test('English message keeps the existing checklist and asks for write access', async () => {
  const message = await buildRepositoryNotAccessibleMessage({ owner: 'acme', repo: 'app', autoAcceptInvite: false, botLogin: 'hive-bot', ownerType: 'Organization', locale: 'en' });
  const lines = message.split('\n');
  assert.equal(lines[0], "Repository 'acme/app' is not accessible.");
  assert.ok(message.includes('💡 Please check:'));
  assert.ok(message.includes('Repository may be private'));
  assert.ok(message.includes('--auto-accept-invite'), 'opted-out runs keep the flag hint');
  assert.ok(message.includes('choose the Write role'), message);
  assert.ok(message.includes(`https://docs.github.com/en${ORG_DOCS_PATH}#inviting-a-team-or-person`), message);
  assert.ok(message.includes('#permissions-for-each-role'), message);
  assert.ok(urlsIn(message).has('https://github.com/acme/app/invitations'), 'manual acceptance links the invitation page');
});

await test('unknown owner type and login still give both docs pages and generic wording', async () => {
  const message = await buildRepositoryNotAccessibleMessage({ owner: 'someone', repo: 'x', autoAcceptInvite: true, locale: 'en' });
  assert.ok(message.includes(INVITE_DOCS_PATH));
  assert.ok(message.includes(`${ORG_DOCS_PATH}#inviting-a-team-or-person`));
  assert.ok(message.includes('the GitHub account Hive Mind runs as'));
  assert.ok(!message.includes('{{'), 'no unfilled placeholders');
});

await test('Hindi readers get Hindi text with English GitHub Docs (GitHub Docs has no Hindi)', async () => {
  const message = await buildRepositoryNotAccessibleMessage({ owner: 'o', repo: 'r', botLogin: 'hive-bot', ownerType: 'User', locale: 'hi' });
  assert.ok(message.includes(`https://docs.github.com/en${INVITE_DOCS_PATH}`), message);
  assert.ok(/[ऀ-ॿ]/.test(message), 'Devanagari text');
  assert.ok(message.includes('GITHUB-ACCESS.hi.md'));
});

await test('an explicit docs locale wins over the text locale (Telegram user with a German app)', async () => {
  const message = await buildRepositoryNotAccessibleMessage({ owner: 'o', repo: 'r', botLogin: 'b', ownerType: 'User', locale: 'en', docsLocale: 'de' });
  assert.ok(message.includes(`https://docs.github.com/de${INVITE_DOCS_PATH}`), message);
});

await test('read-only access on an organization repository asks to change the role to Write', async () => {
  const message = await buildWriteAccessRequiredMessage({ owner: 'acme', repo: 'app', botLogin: 'hive-bot', ownerType: 'Organization', locale: 'zh' });
  assert.ok(message.includes('#changing-permissions-for-a-team-or-person'), message);
  assert.ok(message.includes(`https://docs.github.com/zh${ORG_DOCS_PATH}`), message);
  assert.ok(message.includes('hive-bot'));
});

await test('read-only access on a personal repository asks for a collaborator invitation', async () => {
  const message = await buildWriteAccessRequiredMessage({ owner: 'konard', repo: 'demo', botLogin: 'hive-bot', ownerType: 'User', locale: 'en' });
  assert.ok(message.includes(INVITE_DOCS_PATH), message);
  assert.ok(message.includes('Run the command again'), message);
});

await test('every locale renders every variant without missing keys or placeholders', async () => {
  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    const locales = await resolveAccessGuideLocales({ locale });
    for (const ownerType of ['User', 'Organization', null]) {
      for (const botLogin of ['hive-bot', null]) {
        for (const reason of ['invite', 'upgrade']) {
          for (const autoAcceptInvite of [true, false]) {
            const text = buildGrantWriteAccessLines({ owner: 'o', repo: 'r', botLogin, ownerType, autoAcceptInvite, reason, ...locales }).join('\n');
            assert.ok(!text.includes('github_access.'), `${locale}: missing key in\n${text}`);
            assert.ok(!text.includes('{{'), `${locale}: unfilled placeholder in\n${text}`);
          }
        }
      }
    }
  }
});

await test('the guide page links point at pages that exist in this repository', () => {
  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    const url = buildAccessGuidePageUrl(locale);
    const file = url.split('/blob/main/')[1];
    assert.ok(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').length > 0, file);
  }
  assert.equal(buildAccessGuidePageUrl('xx'), 'https://github.com/link-assistant/hive-mind/blob/main/docs/GITHUB-ACCESS.md');
});

await test('Telegram docs locale: /language choice, then app language, then defaults', () => {
  const userId = 299800001;
  try {
    assert.equal(resolveDocsLocaleFromTelegramCtx({ from: { id: userId, language_code: 'de' } }), 'de');
    setUserLocale(userId, 'ru');
    assert.equal(resolveDocsLocaleFromTelegramCtx({ from: { id: userId, language_code: 'de' } }), 'ru');
    clearUserLocale(userId);
    setDefaultGitHubDocsLocale('ja');
    assert.equal(resolveDocsLocaleFromTelegramCtx({ from: { id: userId, language_code: 'hi' } }), resolveDocsLocaleFromTelegramCtx({}));
    assert.equal(resolveDocsLocaleFromTelegramCtx(undefined), resolveDocsLocaleFromTelegramCtx({}));
  } finally {
    clearUserLocale(userId);
  }
});

await test('getAuthenticatedGitHubLogin caches a valid login and rejects junk', async () => {
  resetAuthenticatedGitHubLoginCache();
  let calls = 0;
  const run = async () => {
    calls++;
    return { code: 0, stdout: 'hive-bot\n' };
  };
  assert.equal(await getAuthenticatedGitHubLogin({ run }), 'hive-bot');
  assert.equal(await getAuthenticatedGitHubLogin({ run }), 'hive-bot');
  assert.equal(calls, 1);
  assert.equal(await getAuthenticatedGitHubLogin({ run: async () => ({ code: 0, stdout: 'x y' }), refresh: true }), null);
  assert.equal(await getAuthenticatedGitHubLogin({ run: async () => ({ code: 1, stdout: '' }), refresh: true }), null);
  assert.equal(
    await getAuthenticatedGitHubLogin({
      run: async () => {
        throw new Error('gh missing');
      },
      refresh: true,
    }),
    null
  );
  resetAuthenticatedGitHubLoginCache();
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
