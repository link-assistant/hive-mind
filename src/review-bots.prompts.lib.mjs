import { promptText } from './prompt-text.lib.mjs';
import { DEFAULT_REVIEW_BOTS_WAIT_MINUTES, parseReviewBotsOption } from './review-bots-options.lib.mjs';

/**
 * Issue #4081 (proposal A): the system-prompt section that tells the AI about
 * automated review apps, asks it to wait a bounded time for them after marking
 * the pull request ready or pushing, and to address their findings.
 * Empty with `--review-bots none`.
 */
export function getReviewBotsSubPrompt({ owner, repo, prNumber, argv } = {}) {
  const bots = parseReviewBotsOption(argv?.reviewBots ?? argv?.['review-bots']);
  if (bots.length === 0) return '';
  const configured = Number(argv?.reviewBotsWaitMinutes ?? argv?.['review-bots-wait-minutes']);
  const minutes = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_REVIEW_BOTS_WAIT_MINUTES;
  return promptText('prompt.system.templates.review-bots-prompts.getReviewBotsSubPrompt.text1', {
    bots: bots.slice(0, 2).join(', '),
    minutes: String(minutes),
    owner: String(owner ?? '<owner>'),
    repo: String(repo ?? '<repo>'),
    prNumber: String(prNumber ?? '<pull-request-number>'),
  });
}

export default { getReviewBotsSubPrompt };
