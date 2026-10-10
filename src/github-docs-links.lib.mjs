/**
 * GitHub Docs links for user-facing advice.
 *
 * Every message that asks a person to change something on GitHub (invite the
 * Hive Mind account, grant Write access, allow maintainer edits, refresh token
 * scopes, ...) should point at the GitHub Docs page that shows how, in the
 * reader's language, and at the section that matters. This module is the single
 * catalogue of those pages, so the CLI, GitHub comments and the Telegram bot
 * give the same links.
 *
 * Paths are the canonical (post-redirect) paths and anchors are the heading ids
 * of the live pages; GitHub Docs keeps the same anchors in every language.
 * `experiments/issue-2998/list-docs-anchors.mjs` re-checks them, and
 * `tests/github-docs-links-2998.test.mjs` verifies them online when
 * HIVE_MIND_CHECK_DOCS_LINKS=1 is set.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2998
 * @see https://docs.github.com/en/contributing/writing-for-github-docs/using-markdown-and-liquid-in-github-docs
 */

export const GITHUB_DOCS_BASE_URL = 'https://docs.github.com';
export const GITHUB_DOCS_DEFAULT_LOCALE = 'en';

/** Languages docs.github.com is published in (other codes return 404). */
export const GITHUB_DOCS_LOCALES = Object.freeze(['en', 'es', 'ja', 'pt', 'zh', 'ru', 'fr', 'ko', 'de']);

/**
 * The catalogue. `anchor` is optional and points at the section with the steps.
 * Keys are stable identifiers used by callers and tests.
 */
export const GITHUB_DOCS_TOPICS = Object.freeze({
  inviteCollaborator: {
    title: 'Inviting collaborators to a personal repository',
    path: '/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository',
    anchor: 'inviting-a-collaborator-to-a-personal-repository',
  },
  collaboratorPermissions: {
    title: 'Permission levels for a personal account repository',
    path: '/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository',
    anchor: 'collaborator-access-for-a-repository-owned-by-a-personal-account',
  },
  organizationRepositoryAccess: {
    title: 'Managing teams and people with access to your repository',
    path: '/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-teams-and-people-with-access-to-your-repository',
    anchor: 'inviting-a-team-or-person',
  },
  changeRepositoryRole: {
    title: 'Changing permissions for a team or person',
    path: '/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-teams-and-people-with-access-to-your-repository',
    anchor: 'changing-permissions-for-a-team-or-person',
  },
  organizationRepositoryRoles: {
    title: 'Repository roles for an organization',
    path: '/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization',
    anchor: 'permissions-for-each-role',
  },
  organizationInvitation: {
    title: 'Inviting users to join your organization',
    path: '/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization',
  },
  acceptOrganizationInvitation: {
    title: 'Accessing an organization',
    path: '/account-and-profile/how-tos/organization-membership/accessing-an-organization',
  },
  allowMaintainerEdits: {
    title: 'Allowing changes to a pull request branch created from a fork',
    path: '/pull-requests/how-tos/work-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork',
    anchor: 'enabling-repository-maintainer-permissions-on-existing-pull-requests',
  },
  repositoryForkingPolicy: {
    title: 'Managing the forking policy for your repository',
    path: '/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-forking-policy-for-your-repository',
  },
  organizationForkingPolicy: {
    title: 'Managing the forking policy for your organization',
    path: '/organizations/managing-organization-settings/managing-the-forking-policy-for-your-organization',
  },
  tokenScopes: {
    title: 'Scopes for OAuth apps',
    path: '/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps',
    anchor: 'available-scopes',
  },
  personalAccessTokens: {
    title: 'Managing your personal access tokens',
    path: '/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
  },
  tokenSso: {
    title: 'Authorizing a personal access token for use with single sign-on',
    path: '/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on',
  },
  resourceNotAccessible: {
    title: 'Troubleshooting the REST API: Resource not accessible',
    path: '/rest/using-the-rest-api/troubleshooting-the-rest-api',
    anchor: 'resource-not-accessible',
  },
  notFoundForExistingResource: {
    title: 'Troubleshooting the REST API: 404 Not Found for an existing resource',
    path: '/rest/using-the-rest-api/troubleshooting-the-rest-api',
    anchor: '404-not-found-for-an-existing-resource',
  },
  rateLimits: {
    title: 'Rate limits for the REST API',
    path: '/rest/using-the-rest-api/rate-limits-for-the-rest-api',
    anchor: 'exceeding-the-rate-limit',
  },
  archivedRepository: {
    title: 'Archiving repositories',
    path: '/repositories/archiving-a-github-repository/archiving-repositories',
  },
  protectedBranches: {
    title: 'About protected branches',
    path: '/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches',
  },
  rulesets: {
    title: 'About rulesets',
    path: '/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets',
  },
  emailPrivacyPush: {
    title: 'Blocking command line pushes that expose your personal email address',
    path: '/account-and-profile/how-tos/email-preferences/blocking-command-line-pushes-that-expose-your-personal-email-address',
  },
  largeFiles: {
    title: 'About large files on GitHub',
    path: '/repositories/working-with-files/managing-large-files/about-large-files-on-github',
  },
  pushProtection: {
    title: 'Working with push protection from the command line',
    path: '/code-security/how-tos/secure-your-secrets/work-with-leak-prevention/push-protection-on-the-command-line',
  },
  disablingIssues: {
    title: 'Disabling issues',
    path: '/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-issues',
  },
  actionsSettings: {
    title: 'Managing GitHub Actions settings for a repository',
    path: '/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository',
  },
});

/** `gh` CLI manual pages (not localized, so they live outside docs.github.com). */
export const GH_CLI_MANUAL_URLS = Object.freeze({
  authLogin: 'https://cli.github.com/manual/gh_auth_login',
  authRefresh: 'https://cli.github.com/manual/gh_auth_refresh',
});

let defaultLocale = null;

const languageOf = value => {
  if (!value || typeof value !== 'string') return null;
  return (
    value
      .trim()
      .toLowerCase()
      .split(/[_\-.@]/)[0] || null
  );
};

/**
 * Pick the GitHub Docs language for the first candidate docs.github.com is
 * published in. Accepts Telegram `language_code`s (`pt-br`), POSIX locales
 * (`de_DE.UTF-8`) and plain codes. Unsupported or empty values are skipped,
 * so `('hi', 'ru')` gives `ru` and `('hi')` gives `en`.
 *
 * @param {...(string|null|undefined)} candidates - most preferred first
 * @returns {string} a member of GITHUB_DOCS_LOCALES
 */
export function resolveGitHubDocsLocale(...candidates) {
  for (const candidate of candidates) {
    const lang = languageOf(candidate);
    if (lang && GITHUB_DOCS_LOCALES.includes(lang)) return lang;
  }
  return GITHUB_DOCS_DEFAULT_LOCALE;
}

/**
 * Set the process-wide docs language. The CLI calls this once after parsing
 * `--language`/`--ui-language`; the Telegram bot passes a locale per message
 * instead, because one process serves many users.
 *
 * @param {...(string|null|undefined)} candidates - same as resolveGitHubDocsLocale
 * @returns {string} the resolved locale
 */
export function setDefaultGitHubDocsLocale(...candidates) {
  defaultLocale = resolveGitHubDocsLocale(...candidates);
  return defaultLocale;
}

/**
 * The docs language used when a caller does not pass one: the value set by
 * setDefaultGitHubDocsLocale(), else the POSIX locale environment, else `en`.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string}
 */
export function getDefaultGitHubDocsLocale(env = process.env) {
  if (defaultLocale) return defaultLocale;
  return resolveGitHubDocsLocale(env.LC_ALL, env.LC_MESSAGES, env.LANG, env.LANGUAGE);
}

/** Forget the process-wide docs language (tests). */
export function resetDefaultGitHubDocsLocale() {
  defaultLocale = null;
}

/**
 * Build a GitHub Docs URL.
 *
 * @param {string} topic - key of GITHUB_DOCS_TOPICS
 * @param {Object} [options]
 * @param {string} [options.locale] - any value resolveGitHubDocsLocale accepts
 * @param {boolean} [options.anchor=true] - append the section anchor when the topic has one
 * @returns {string}
 */
export function buildGitHubDocsUrl(topic, { locale, anchor = true } = {}) {
  const entry = GITHUB_DOCS_TOPICS[topic];
  if (!entry) throw new Error(`Unknown GitHub Docs topic: ${topic}`);
  const lang = locale ? resolveGitHubDocsLocale(locale) : getDefaultGitHubDocsLocale();
  const hash = anchor && entry.anchor ? `#${entry.anchor}` : '';
  return `${GITHUB_DOCS_BASE_URL}/${lang}${entry.path}${hash}`;
}

/**
 * A "📖 Title: URL" line for plain-text output (console, Telegram, GitHub comments).
 *
 * @param {string} topic - key of GITHUB_DOCS_TOPICS
 * @param {Object} [options]
 * @param {string} [options.locale]
 * @param {string} [options.label] - text before the URL (defaults to the page title)
 * @returns {string}
 */
export function formatGitHubDocsLine(topic, { locale, label } = {}) {
  return `📖 ${label || GITHUB_DOCS_TOPICS[topic]?.title || topic}: ${buildGitHubDocsUrl(topic, { locale })}`;
}

/** The repository page where an admin invites collaborators and teams. */
export const buildRepositoryAccessSettingsUrl = (owner, repo) => `https://github.com/${owner}/${repo}/settings/access`;

/** The repository's general settings page (features, forking, archiving). */
export const buildRepositorySettingsUrl = (owner, repo) => `https://github.com/${owner}/${repo}/settings`;

/** Where the invited account accepts a repository invitation. */
export const buildRepositoryInvitationUrl = (owner, repo) => `https://github.com/${owner}/${repo}/invitations`;

/** Where the invited account accepts an organization invitation. */
export const buildOrganizationInvitationUrl = org => `https://github.com/orgs/${org}/invitation`;
