/**
 * "Give Hive Mind access to the repository" guidance.
 *
 * When the GitHub account Hive Mind runs as cannot see or write to a
 * repository, the reader needs three things: which account to invite, where to
 * click, and GitHub's own documentation for the step, in their language. The
 * same text is shown in the CLI, posted in GitHub comments and replied in
 * Telegram, so it is built here once.
 *
 * Message text comes from src/locales/*.lino (`github_access.*`); docs links
 * come from github-docs-links.lib.mjs and use the closest language GitHub Docs
 * is published in (Hindi readers get English docs).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2998
 */

import { t, loadTranslations, normalizeLocale, getUiLocale, getUserLocale } from './i18n.lib.mjs';
import { buildGitHubDocsUrl, buildRepositoryAccessSettingsUrl, buildRepositoryInvitationUrl, getDefaultGitHubDocsLocale, resolveGitHubDocsLocale } from './github-docs-links.lib.mjs';

/** Repository that hosts the access guide pages and the example animation. */
export const ACCESS_GUIDE_REPOSITORY_URL = 'https://github.com/link-assistant/hive-mind';

/**
 * The step-by-step access guide in this repository (docs/GITHUB-ACCESS*.md).
 *
 * @param {string} [locale] - Hive Mind UI locale (en/ru/zh/hi)
 * @returns {string}
 */
export function buildAccessGuidePageUrl(locale) {
  const ui = normalizeLocale(locale) || 'en';
  const suffix = ui === 'en' ? '' : `.${ui}`;
  return `${ACCESS_GUIDE_REPOSITORY_URL}/blob/main/docs/GITHUB-ACCESS${suffix}.md`;
}

/**
 * Resolve the text locale (Hive Mind locales) and the docs locale (GitHub Docs
 * locales) for one message, and make sure the text translations are loaded.
 *
 * @param {Object} [options]
 * @param {string} [options.locale] - preferred language (UI locale, Telegram language_code, ...)
 * @param {string} [options.docsLocale] - explicit GitHub Docs language
 * @returns {Promise<{uiLocale: string, docsLocale: string}>}
 */
export async function resolveAccessGuideLocales({ locale, docsLocale } = {}) {
  const uiLocale = normalizeLocale(locale) || getUiLocale() || 'en';
  await loadTranslations('en');
  if (uiLocale !== 'en') await loadTranslations(uiLocale);
  const resolvedDocsLocale = docsLocale ? resolveGitHubDocsLocale(docsLocale) : locale ? resolveGitHubDocsLocale(locale, getDefaultGitHubDocsLocale()) : getDefaultGitHubDocsLocale();
  return { uiLocale, docsLocale: resolvedDocsLocale };
}

/**
 * GitHub Docs language for a Telegram update: the user's /language choice,
 * then their Telegram app language (GitHub Docs covers languages Hive Mind's
 * own UI does not, e.g. de/es/ja), then the bot defaults.
 *
 * @param {Object} ctx - Telegraf context
 * @returns {string}
 */
export const resolveDocsLocaleFromTelegramCtx = ctx => resolveGitHubDocsLocale(getUserLocale(ctx?.from?.id), ctx?.from?.language_code, getUiLocale(), getDefaultGitHubDocsLocale());

/** True when `gh api users/<owner> --jq .type` reported an organization. */
export const isOrganizationOwner = ownerType => String(ownerType || '').toLowerCase() === 'organization';

/**
 * Lines that tell a repository admin how to give the Hive Mind account write
 * access: invite page, button names, the right GitHub Docs sections and the
 * visual guide. Locales must already be loaded (see resolveAccessGuideLocales).
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string|null} [options.botLogin] - account Hive Mind runs as (null when unknown)
 * @param {string|null} [options.ownerType] - 'User' or 'Organization' (null when unknown)
 * @param {boolean} [options.autoAcceptInvite=true] - whether the next run accepts the invitation by itself
 * @param {'invite'|'upgrade'} [options.reason='invite'] - no access at all, or read-only access
 * @param {string} options.uiLocale
 * @param {string} options.docsLocale
 * @returns {string[]}
 */
export function buildGrantWriteAccessLines({ owner, repo, botLogin = null, ownerType = null, autoAcceptInvite = true, reason = 'invite', uiLocale, docsLocale }) {
  const locale = uiLocale;
  const organization = isOrganizationOwner(ownerType);
  const login = botLogin || null;
  const lines = [];
  const headingKey = `github_access.${reason === 'upgrade' ? 'upgrade' : 'invite'}_heading${login ? '' : '_unknown'}`;
  lines.push(t(headingKey, { login }, { locale }));
  lines.push(t('github_access.step_open', { url: buildRepositoryAccessSettingsUrl(owner, repo) }, { locale }));
  if (reason === 'upgrade') {
    lines.push(t(`github_access.step_change_role${login ? '' : '_unknown'}`, { login }, { locale }));
  } else {
    const kind = organization ? 'org' : 'personal';
    lines.push(t(`github_access.step_add_${kind}${login ? '' : '_unknown'}`, { login, repo }, { locale }));
    lines.push(autoAcceptInvite ? t('github_access.step_accept_auto', {}, { locale }) : t('github_access.step_accept_manual', { url: buildRepositoryInvitationUrl(owner, repo) }, { locale }));
  }
  // An unknown owner type gets both docs pages: the personal one first, since
  // that is the case in the original report.
  if (reason === 'upgrade') {
    lines.push(t('github_access.docs_change_role', { url: buildGitHubDocsUrl('changeRepositoryRole', { locale: docsLocale }) }, { locale }));
  } else {
    const inviteTopics = ownerType ? [organization ? 'organizationRepositoryAccess' : 'inviteCollaborator'] : ['inviteCollaborator', 'organizationRepositoryAccess'];
    for (const topic of inviteTopics) {
      const key = topic === 'inviteCollaborator' ? 'docs_invite_personal' : 'docs_invite_org';
      lines.push(t(`github_access.${key}`, { url: buildGitHubDocsUrl(topic, { locale: docsLocale }) }, { locale }));
    }
  }
  const rolesTopic = organization ? 'organizationRepositoryRoles' : 'collaboratorPermissions';
  lines.push(t('github_access.docs_roles', { url: buildGitHubDocsUrl(rolesTopic, { locale: docsLocale }) }, { locale }));
  lines.push(t('github_access.visual_guide', { url: buildAccessGuidePageUrl(locale) }, { locale }));
  return lines;
}

/**
 * The message for "repository not found or not visible to Hive Mind" (GitHub
 * answers 404 for private repositories the account cannot see).
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {boolean} [options.autoAcceptInvite=false] - the run already accepts invitations
 * @param {string|null} [options.botLogin]
 * @param {string|null} [options.ownerType]
 * @param {string} [options.locale] - reader's language
 * @param {string} [options.docsLocale] - GitHub Docs language override
 * @returns {Promise<string>}
 */
export async function buildRepositoryNotAccessibleMessage({ owner, repo, autoAcceptInvite = false, botLogin = null, ownerType = null, locale, docsLocale } = {}) {
  const locales = await resolveAccessGuideLocales({ locale, docsLocale });
  const ui = locales.uiLocale;
  const checks = [t('github_access.check_private', {}, { locale: ui }), t('github_access.check_spelling', {}, { locale: ui }), t('github_access.check_exists', {}, { locale: ui })];
  if (!autoAcceptInvite) checks.push(t('github_access.check_auto_accept', {}, { locale: ui }));
  const grant = buildGrantWriteAccessLines({ owner, repo, botLogin, ownerType, autoAcceptInvite, reason: 'invite', ...locales });
  return [t('github_access.repo_not_accessible', { repository: `${owner}/${repo}` }, { locale: ui }), '', t('github_access.please_check', {}, { locale: ui }), ...checks, '', ...grant].join('\n');
}

/**
 * The message for "the repository is visible but Hive Mind cannot push".
 *
 * @param {Object} options - same as buildRepositoryNotAccessibleMessage
 * @returns {Promise<string>}
 */
export async function buildWriteAccessRequiredMessage({ owner, repo, botLogin = null, ownerType = null, autoAcceptInvite = true, locale, docsLocale } = {}) {
  const locales = await resolveAccessGuideLocales({ locale, docsLocale });
  // Collaborators on a personal repository always have write access, so a
  // read-only account there is not a collaborator yet and needs an invitation.
  const reason = isOrganizationOwner(ownerType) ? 'upgrade' : 'invite';
  return buildGrantWriteAccessLines({ owner, repo, botLogin, ownerType, autoAcceptInvite, reason, ...locales }).join('\n');
}

// Runs a read-only `gh` probe without echoing it.
async function runQuietGh(strings, ...values) {
  const { ensureUseM } = await import('./use-m-bootstrap.lib.mjs');
  if (typeof globalThis.use === 'undefined') await ensureUseM();
  const { $ } = await use('command-stream');
  const { QUIET_PROBE } = await import('./quiet-probe.lib.mjs');
  return await $(QUIET_PROBE)(strings, ...values);
}

/**
 * 'User' or 'Organization' for a GitHub account (picks the personal or the
 * organization guide), null when unknown.
 *
 * @param {string} owner
 * @param {Object} [options]
 * @param {Function} [options.run] - runs `gh api users/<owner> --jq .type`, resolves to {code, stdout}
 * @returns {Promise<string|null>}
 */
export async function getGitHubOwnerType(owner, { run } = {}) {
  try {
    const result = await (run ? run(owner) : runQuietGh`gh api users/${owner} --jq .type`);
    const type = result?.code === 0 ? (result.stdout?.toString() || '').trim() : '';
    return ['User', 'Organization'].includes(type) ? type : null;
  } catch {
    return null;
  }
}

let cachedLogin;

/**
 * Login of the account `gh` is authenticated as, cached per process once
 * known. Returns null for integration tokens (they cannot read GET /user) and
 * on errors, so callers fall back to wording that does not name the account.
 *
 * @param {Object} [options]
 * @param {Function} [options.run] - runs `gh api user --jq .login`, resolves to {code, stdout}
 * @param {boolean} [options.refresh=false]
 * @returns {Promise<string|null>}
 */
export async function getAuthenticatedGitHubLogin({ run, refresh = false } = {}) {
  if (cachedLogin !== undefined && !refresh) return cachedLogin;
  try {
    const result = await (run ? run() : runQuietGh`gh api user --jq .login`);
    const login = result?.code === 0 ? (result.stdout?.toString() || '').trim() : '';
    if (!/^[A-Za-z0-9-]+(\[bot\])?$/.test(login)) return null;
    cachedLogin = login;
    return login;
  } catch {
    return null;
  }
}

/** Forget the cached login (tests). */
export function resetAuthenticatedGitHubLoginCache() {
  cachedLogin = undefined;
}
