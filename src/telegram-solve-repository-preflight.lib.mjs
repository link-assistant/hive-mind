/**
 * Read-only repository-mode preflight for Telegram `/solve` commands.
 *
 * A repository with no open issues is a successful no-op, so there is no
 * reason to reserve queue capacity or launch an isolated work session merely
 * to discover that fact. The CLI repeats this check when it starts because the
 * repository can change between this preflight and process execution.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2266
 */

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
 * @returns {Promise<{applicable: boolean, noWork: boolean, repository?: object, totalOpen?: number}>}
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
export async function replyIfRepositoryHasNoWork({ ctx, parsed, locale, run, reply = safeReply, translate = t, escape = escapeMarkdown, onError = null } = {}) {
  try {
    const repositoryWork = await checkRepositoryModeWork({ parsed, run });
    if (!repositoryWork.noWork) return false;

    const message = translate('telegram.repository_no_open_issues', { repository: escape(repositoryWork.repository.fullName) }, { locale });
    await reply(ctx, message, { reply_to_message_id: ctx.message.message_id });
    return true;
  } catch (error) {
    await onError?.(error);
    return false;
  }
}

export default { checkRepositoryModeWork, replyIfRepositoryHasNoWork };
