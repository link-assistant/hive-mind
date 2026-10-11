/**
 * Read-only repository-mode preflight for Telegram `/solve` commands.
 *
 * A repository with no open issues is a successful no-op, so there is no
 * reason to reserve queue capacity or launch an isolated work session merely
 * to discover that fact. The CLI repeats this check when it starts because the
 * repository can change between this preflight and process execution.
 *
 * A repository with exactly one open issue is solved as that issue (issue
 * #3108), so the chat shows — and the session receives — the issue URL itself
 * instead of the repository URL.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2266
 * @see https://github.com/link-assistant/hive-mind/issues/3108
 */

import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { prepareRepositoryModeIssue } from './solve.repository-mode.run.lib.mjs';
import { t } from './i18n.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { safeReply } from './telegram-safe-reply.lib.mjs';

/**
 * Check whether a parsed repository URL currently has work for repository
 * mode. Non-repository targets are deliberately ignored.
 *
 * Errors are allowed to propagate. The Telegram caller treats this as a
 * best-effort optimization and starts the normal solve session on failure, so
 * the CLI can report the authoritative diagnostic in its full log.
 *
 * @param {object} params
 * @param {object|null} params.parsed - Result from parseGitHubUrl().
 * @param {Function} [params.run] - Command runner override for tests.
 * @returns {Promise<{applicable: boolean, noWork: boolean, repository?: object, totalOpen?: number, singleIssue?: {number: number, url: string}|null}>}
 */
export async function checkRepositoryModeWork({ parsed, run } = {}) {
  if (parsed?.type !== 'repo' || !parsed.owner || !parsed.repo) {
    return { applicable: false, noWork: false };
  }

  const repository = {
    owner: parsed.owner,
    repo: parsed.repo,
    fullName: `${parsed.owner}/${parsed.repo}`,
    url: parsed.canonical || parsed.normalized || `https://github.com/${parsed.owner}/${parsed.repo}`,
  };
  const prepared = await prepareRepositoryModeIssue({ repository, run });

  return {
    applicable: true,
    noWork: prepared.selected.length === 0,
    repository,
    totalOpen: prepared.totalOpen,
    singleIssue: prepared.singleIssue || null,
  };
}

/**
 * Reply directly when a repository target has no work. A failed preflight is
 * deliberately non-authoritative: the caller should continue with the normal
 * solve path, which can retry and retain complete diagnostics.
 *
 * @param {object} params
 * @param {object} params.ctx - Telegram context.
 * @param {object|null} params.parsed - Result from parseGitHubUrl().
 * @param {string} params.locale - Effective Telegram locale.
 * @param {Function} [params.run] - Command runner override for tests.
 * @param {Function} [params.reply]
 * @param {Function} [params.translate]
 * @param {Function} [params.escape]
 * @param {Function} [params.onError]
 * @returns {Promise<boolean>} Whether the no-work response was sent.
 */
export async function replyIfRepositoryHasNoWork(params = {}) {
  return (await preflightRepositoryTarget(params)).repliedNoWork;
}

/**
 * Run the repository-mode preflight: reply directly when there is no work
 * (issue #2266) and report the issue to solve instead when there is exactly
 * one (issue #3108). Failures are non-authoritative, as in
 * {@link replyIfRepositoryHasNoWork}: the CLI repeats both checks.
 *
 * @param {object} params - same as {@link replyIfRepositoryHasNoWork}
 * @returns {Promise<{repliedNoWork: boolean, singleIssue: {number: number, url: string}|null}>}
 */
export async function preflightRepositoryTarget({ ctx, parsed, locale, run, reply = safeReply, translate = t, escape = escapeMarkdown, onError = null } = {}) {
  try {
    const repositoryWork = await checkRepositoryModeWork({ parsed, run });
    if (!repositoryWork.noWork) return { repliedNoWork: false, singleIssue: repositoryWork.singleIssue || null };

    const message = translate('telegram.repository_no_open_issues', { repository: escape(repositoryWork.repository.fullName) }, { locale });
    await reply(ctx, message, { reply_to_message_id: ctx.message.message_id });
    return { repliedNoWork: true, singleIssue: null };
  } catch (error) {
    await onError?.(error);
    return { repliedNoWork: false, singleIssue: null };
  }
}

/**
 * Point a repository-mode `/solve` command at its single open issue.
 *
 * Every argument that is the repository URL (as typed, normalized or
 * canonical) is replaced by the issue URL; all options are kept as they are.
 * Returns null when the issue URL cannot be parsed or the repository URL is not
 * found in the arguments, so the caller keeps the repository URL and lets the
 * CLI make the same decision.
 *
 * @param {object} params
 * @param {string[]} params.args - solve arguments
 * @param {object} params.parsed - parseGitHubUrl() result of the repository URL
 * @param {{url: string}} params.singleIssue
 * @returns {{args: string[], parsed: object}|null}
 */
export function redirectRepositoryArgsToSingleIssue({ args, parsed, singleIssue }) {
  const issueParsed = singleIssue?.url ? parseGitHubUrl(singleIssue.url) : null;
  if (!issueParsed?.valid || issueParsed.type !== 'issue') return null;
  const issueUrl = issueParsed.canonical || issueParsed.normalized;
  const repositoryUrls = new Set([parsed?.original, parsed?.normalized, parsed?.canonical].filter(Boolean));
  const list = Array.isArray(args) ? args : [];
  if (!list.some(arg => repositoryUrls.has(arg))) return null;
  return { args: list.map(arg => (repositoryUrls.has(arg) ? issueUrl : arg)), parsed: issueParsed };
}

export default { checkRepositoryModeWork, preflightRepositoryTarget, redirectRepositoryArgsToSingleIssue, replyIfRepositoryHasNoWork };
