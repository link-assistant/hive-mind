#!/usr/bin/env node
/**
 * Issue #2998: advice that asks a person to change something on GitHub links
 * the GitHub Docs page for it, in the reader's language and at the right
 * section.
 *
 * Offline checks cover locale resolution and URL building. Set
 * HIVE_MIND_CHECK_DOCS_LINKS=1 to also fetch every catalogued page (en and ru)
 * and confirm it answers 200 and still has the anchor we link to.
 *
 * Run with: node tests/github-docs-links-2998.test.mjs
 */

import assert from 'node:assert/strict';
import { GITHUB_DOCS_TOPICS, buildGitHubDocsUrl, buildOrganizationInvitationUrl, buildRepositoryAccessSettingsUrl, buildRepositoryInvitationUrl, formatGitHubDocsLine, getDefaultGitHubDocsLocale, resetDefaultGitHubDocsLocale, resolveGitHubDocsLocale, setDefaultGitHubDocsLocale } from '../src/github-docs-links.lib.mjs';

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

await test('the invitation page from the issue is linked with its section anchor', () => {
  assert.equal(buildGitHubDocsUrl('inviteCollaborator', { locale: 'ru' }), 'https://docs.github.com/ru/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository#inviting-a-collaborator-to-a-personal-repository');
  assert.equal(buildGitHubDocsUrl('inviteCollaborator', { locale: 'en', anchor: false }), 'https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository');
});

await test('locale resolution accepts Telegram, POSIX and plain codes', () => {
  assert.equal(resolveGitHubDocsLocale('ru'), 'ru');
  assert.equal(resolveGitHubDocsLocale('pt-br'), 'pt');
  assert.equal(resolveGitHubDocsLocale('de_DE.UTF-8'), 'de');
  assert.equal(resolveGitHubDocsLocale('zh-hans'), 'zh');
  assert.equal(resolveGitHubDocsLocale('ZH_cn'), 'zh');
});

await test('languages GitHub Docs does not publish fall through to the next candidate, then English', () => {
  assert.equal(resolveGitHubDocsLocale('hi', 'ru'), 'ru');
  assert.equal(resolveGitHubDocsLocale('hi'), 'en');
  assert.equal(resolveGitHubDocsLocale(null, undefined, ''), 'en');
  assert.equal(resolveGitHubDocsLocale('C.UTF-8'), 'en');
  assert.match(buildGitHubDocsUrl('rateLimits', { locale: 'hi' }), /^https:\/\/docs\.github\.com\/en\//);
});

await test('the process default comes from setDefaultGitHubDocsLocale, else the POSIX environment', () => {
  assert.equal(getDefaultGitHubDocsLocale({ LANG: 'ja_JP.UTF-8' }), 'ja');
  assert.equal(getDefaultGitHubDocsLocale({ LC_ALL: 'C', LANG: 'fr_FR.UTF-8' }), 'fr');
  assert.equal(getDefaultGitHubDocsLocale({}), 'en');
  assert.equal(setDefaultGitHubDocsLocale('hi', 'ko'), 'ko');
  assert.equal(getDefaultGitHubDocsLocale({ LANG: 'ja_JP.UTF-8' }), 'ko');
  assert.match(buildGitHubDocsUrl('tokenScopes'), /^https:\/\/docs\.github\.com\/ko\/apps\/oauth-apps\/building-oauth-apps\/scopes-for-oauth-apps#available-scopes$/);
});

await test('every topic has a title, a docs path and a heading-id anchor', () => {
  for (const [key, entry] of Object.entries(GITHUB_DOCS_TOPICS)) {
    assert.ok(entry.title, `${key} title`);
    assert.match(entry.path, /^\/[a-z0-9@.\-/]+$/, `${key} path`);
    assert.ok(!entry.path.startsWith('/en/'), `${key} path must not carry a locale`);
    if (entry.anchor) assert.match(entry.anchor, /^[a-z0-9-]+$/, `${key} anchor`);
  }
});

await test('unknown topics fail loudly instead of producing a dead link', () => {
  assert.throws(() => buildGitHubDocsUrl('noSuchTopic'), /Unknown GitHub Docs topic/);
});

await test('formatGitHubDocsLine renders a plain-text line', () => {
  assert.equal(formatGitHubDocsLine('allowMaintainerEdits', { locale: 'en', label: 'Allow edits by maintainers' }), '📖 Allow edits by maintainers: https://docs.github.com/en/pull-requests/how-tos/work-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork#enabling-repository-maintainer-permissions-on-existing-pull-requests');
  assert.match(formatGitHubDocsLine('largeFiles', { locale: 'de' }), /^📖 About large files on GitHub: https:\/\/docs\.github\.com\/de\//);
});

await test('github.com settings and invitation pages', () => {
  assert.equal(buildRepositoryAccessSettingsUrl('konard', 'demo'), 'https://github.com/konard/demo/settings/access');
  assert.equal(buildRepositoryInvitationUrl('konard', 'demo'), 'https://github.com/konard/demo/invitations');
  assert.equal(buildOrganizationInvitationUrl('link-assistant'), 'https://github.com/orgs/link-assistant/invitation');
});

if (process.env.HIVE_MIND_CHECK_DOCS_LINKS === '1') {
  for (const locale of ['en', 'ru']) {
    for (const key of Object.keys(GITHUB_DOCS_TOPICS)) {
      await test(`online: ${locale} ${key} answers 200 and keeps its anchor`, async () => {
        const url = buildGitHubDocsUrl(key, { locale, anchor: false });
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
        assert.equal(response.status, 200, `${url} -> ${response.status} ${response.headers.get('location') || ''}`);
        const { anchor } = GITHUB_DOCS_TOPICS[key];
        if (anchor) assert.ok((await response.text()).includes(`id="${anchor}"`), `${url} has no #${anchor}`);
      });
    }
  }
} else {
  console.log('ℹ️  Online link check skipped (set HIVE_MIND_CHECK_DOCS_LINKS=1 to run it)');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
