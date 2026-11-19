#!/usr/bin/env node
/**
 * Issue #4081: which logins are automated pull request review apps
 * (`--review-bots`) and how long to wait for them (`--review-bots-wait-minutes`).
 *
 * Kept free of GitHub client imports, so the system-prompt modules can use it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4081
 */

/** Review apps whose comments and reviews are feedback (the `--review-bots` default). */
export const DEFAULT_REVIEW_BOTS = Object.freeze(['chatgpt-codex-connector[bot]', 'coderabbitai[bot]', 'copilot-pull-request-reviewer[bot]', 'gemini-code-assist[bot]', 'sourcery-ai[bot]', 'qodo-merge-pro[bot]', 'cursor[bot]', 'greptile-apps[bot]']);

/** How long the loop waits for a review app that is reviewing the head commit. */
export const DEFAULT_REVIEW_BOTS_WAIT_MINUTES = 15;

/**
 * How long the loop waits for a review app that reviewed an earlier commit of
 * this pull request but has shown no sign yet for the head commit. Not every
 * app re-reviews every push, so this is short.
 */
export const REVIEW_BOTS_START_GRACE_MINUTES = 3;

/** GraphQL logins of GitHub Apps have no `[bot]` suffix; REST logins have it. */
export const normalizeBotLogin = login =>
  String(login || '')
    .trim()
    .toLowerCase()
    .replace(/\[bot\]$/, '');

/**
 * `--review-bots` value → list of logins.
 *
 * - unset / `true` / `default` → {@link DEFAULT_REVIEW_BOTS}
 * - `none`, `off`, `false` or an empty string → no review apps
 * - a comma or space separated list; the word `default` inside it expands to
 *   the default list, so `default,my-reviewer[bot]` adds one app.
 */
export const parseReviewBotsOption = value => {
  if (value === undefined || value === null || value === true) return [...DEFAULT_REVIEW_BOTS];
  if (value === false) return [];
  const tokens = (Array.isArray(value) ? value.join(',') : String(value))
    .split(/[\s,]+/)
    .map(token => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];
  if (tokens.length === 1 && /^(?:none|off|false|0)$/i.test(tokens[0])) return [];
  const result = [];
  const seen = new Set();
  for (const token of tokens) {
    for (const login of /^default$/i.test(token) ? DEFAULT_REVIEW_BOTS : [token]) {
      const key = normalizeBotLogin(login);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(login);
    }
  }
  return result;
};

/** `login => boolean` for the given review app list (REST and GraphQL logins both match). */
export const createReviewBotMatcher = (reviewBots = DEFAULT_REVIEW_BOTS) => {
  const keys = new Set((reviewBots || []).map(normalizeBotLogin).filter(Boolean));
  return login => Boolean(login) && keys.has(normalizeBotLogin(login));
};

export default { DEFAULT_REVIEW_BOTS, DEFAULT_REVIEW_BOTS_WAIT_MINUTES, REVIEW_BOTS_START_GRACE_MINUTES, normalizeBotLogin, parseReviewBotsOption, createReviewBotMatcher };
