/* eslint-disable no-await-in-loop -- the links of a batch start one at a time, with a pause between two starts (#4067) */
/**
 * Several GitHub issue / pull request links in one /solve (or /claude, /codex, …)
 * command (issue #4067).
 *
 * A reply to a message that lists many links, or a command that lists many links
 * itself, used to be refused with "Found N GitHub links in the message". Now each
 * link is started as if the command had been sent once per link:
 *
 * - every valid link gets its own "Starting…" / "Queued…" reply to the same
 *   command message, one at a time, with a random 10–15 second pause between
 *   two starts;
 * - links that cannot be started (malformed, not an issue or pull request, not
 *   found, already running or queued, rejected by the queue) are not answered one
 *   by one; one summary lists them after every valid link has been started;
 * - an error in the options (the same for every link) is answered once, and
 *   nothing is started.
 *
 * The command handler owns the per-link launch, so this module only decides which
 * links to start, paces them and builds the summary. Everything that touches
 * Telegram or the clock is injected, which keeps it testable without a bot.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4067
 */

import { t } from './i18n.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';

/** The pause between two starts is chosen at random in this range (issue #4067). */
export const SOLVE_BATCH_DELAY_MIN_MS = 10_000;
export const SOLVE_BATCH_DELAY_MAX_MS = 15_000;

/** Error scopes a per-link launch reports to the batch. */
export const SOLVE_REJECT_SCOPE = Object.freeze({ OPTIONS: 'options', TARGET: 'target' });

const TARGET_TYPES = new Set(['issue', 'pull']);

/** A word that is written as a link to github.com, not one that just names the host in prose. */
function looksLikeGitHubLink(word, mentionsGitHubHost) {
  return mentionsGitHubHost(word) && /github\.com\//i.test(word);
}

/**
 * Collect the GitHub issue and pull request links in a text, in order, without
 * duplicates, plus every other GitHub link that cannot be started.
 *
 * @param {string} text
 * @param {Object} deps
 * @param {Function} deps.parseGitHubUrl
 * @param {Function} deps.cleanNonPrintableChars
 * @param {Function} deps.mentionsGitHubHost
 * A link listed twice is started once; `duplicates` names such links for logging.
 *
 * @returns {{ urls: string[], invalidLinks: string[], duplicates: string[] }}
 */
export function extractGitHubTargetLinks(text, { parseGitHubUrl, cleanNonPrintableChars, mentionsGitHubHost }) {
  const urls = [];
  const invalidLinks = [];
  const duplicates = [];
  if (!text || typeof text !== 'string') return { urls, invalidLinks, duplicates };
  // Split on Unicode whitespace before cleanup, as extractGitHubUrl does (#1325).
  for (const word of text.split(/\p{White_Space}+/u).map(cleanNonPrintableChars)) {
    if (!word) continue;
    const parsed = parseGitHubUrl(word);
    if (parsed.valid && TARGET_TYPES.has(parsed.type)) {
      const url = parsed.canonical || parsed.normalized;
      if (urls.includes(url)) {
        if (!duplicates.includes(url)) duplicates.push(url);
      } else urls.push(url);
    } else if (looksLikeGitHubLink(word, mentionsGitHubHost) && !invalidLinks.includes(word)) {
      invalidLinks.push(word);
    }
  }
  return { urls, invalidLinks, duplicates };
}

/**
 * The text a replied message offers for link extraction: its text or caption,
 * plus the targets of hidden links (`text_link` entities), which are not part of
 * the visible text.
 */
export function getReplyLinkText(replyMessage) {
  if (!replyMessage) return '';
  const text = replyMessage.text || replyMessage.caption || '';
  const entities = replyMessage.entities || replyMessage.caption_entities || [];
  const hidden = entities.filter(entity => entity?.type === 'text_link' && typeof entity.url === 'string').map(entity => entity.url);
  return [text, ...hidden].filter(Boolean).join('\n');
}

/**
 * Split the command arguments into the GitHub links they list and the options.
 * Only arguments that are themselves GitHub links count: no /solve option takes a
 * GitHub URL value, and a quoted option value with spaces never parses as one.
 *
 * @returns {{ urls: string[], invalidLinks: string[], duplicates: string[], optionArgs: string[] }}
 */
export function splitCommandTargetLinks(args, deps) {
  const optionArgs = [];
  const linkArgs = [];
  for (const arg of args) {
    const cleaned = deps.cleanNonPrintableChars(arg);
    const parsed = deps.parseGitHubUrl(cleaned);
    if ((parsed.valid && TARGET_TYPES.has(parsed.type)) || (!arg.startsWith('-') && looksLikeGitHubLink(cleaned, deps.mentionsGitHubHost))) linkArgs.push(arg);
    else optionArgs.push(arg);
  }
  return { ...extractGitHubTargetLinks(linkArgs.join(' '), deps), optionArgs };
}

/**
 * Decide whether a /solve command starts one link (the existing flow) or a batch.
 *
 * @param {Object} params
 * @param {string[]} params.userArgs - Parsed command arguments
 * @param {boolean} params.commandHasUrl - Whether the command itself names a URL
 * @param {Object|null} params.replyMessage - The replied message (null when not a reply)
 * @param {Object} params.deps - { parseGitHubUrl, cleanNonPrintableChars, mentionsGitHubHost }
 * @returns {{ mode: 'single', userArgs: string[], fromReply: boolean }
 *   | { mode: 'batch', urls: string[], invalidLinks: string[], duplicates: string[], optionArgs: string[], fromReply: boolean }
 *   | { mode: 'no-link' }}
 */
export function planSolveTargets({ userArgs, commandHasUrl, replyMessage, deps }) {
  if (commandHasUrl) {
    const inline = splitCommandTargetLinks(userArgs, deps);
    if (inline.urls.length > 1) return { mode: 'batch', ...inline, fromReply: false };
    return { mode: 'single', userArgs, fromReply: false };
  }
  if (!replyMessage) return { mode: 'single', userArgs, fromReply: false };
  const found = extractGitHubTargetLinks(getReplyLinkText(replyMessage), deps);
  if (found.urls.length === 0) return { mode: 'no-link' };
  // Issue #1325: the options of the command are kept after the extracted link.
  if (found.urls.length === 1) return { mode: 'single', userArgs: [found.urls[0], ...userArgs], fromReply: true };
  return { mode: 'batch', ...found, optionArgs: userArgs, fromReply: true };
}

/** A random pause in [min, max] milliseconds. */
export function pickSolveBatchDelayMs({ min = SOLVE_BATCH_DELAY_MIN_MS, max = SOLVE_BATCH_DELAY_MAX_MS, random = Math.random } = {}) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(random() * (high - low + 1));
}

const defaultSleep = ms =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

/** The first paragraph of a reply: the error line, without help text or input location. */
export function summarizeRejection(text) {
  const firstParagraph = String(text || '')
    .split(/\n\s*\n/)[0]
    .trim();
  return firstParagraph.replace(/^❌\s*/u, '') || '—';
}

/**
 * The summary reason for a GitHub link that is not an issue or pull request link.
 * A repository link is a valid /solve target on its own (#2212), but it solves a
 * whole repository, so it is never started from a list of links.
 *
 * @param {string} link
 * @param {Object} params
 * @param {Function} params.parseGitHubUrl
 * @param {(link: string) => { error?: string }} params.validateUrl - Markdown error for a link /solve cannot use
 * @param {string|null} [params.locale]
 */
export function describeInvalidBatchLink(link, { parseGitHubUrl, validateUrl, locale = null }) {
  const parsed = parseGitHubUrl(link);
  if (parsed.valid && parsed.type === 'repo') return t('telegram.solve_batch_repository', {}, { locale });
  return summarizeRejection(validateUrl(link)?.error);
}

/**
 * Build the summary of links that were not started (Markdown).
 *
 * @param {Object} params
 * @param {number} params.total - Number of distinct links in the command
 * @param {number} params.started - Number of links started or queued
 * @param {Array<{ url: string, reason: string }>} params.notStarted - `reason` is Telegram Markdown
 * @param {string|null} [params.locale]
 */
export function buildSolveBatchSummary({ total, started, notStarted, locale = null }) {
  const items = notStarted.map((entry, index) => `${index + 1}. ${escapeMarkdown(entry.url)} — ${entry.reason}`).join('\n'); // telegram-markdown-ok: reason is Markdown the single-link flow already sends
  return t('telegram.solve_batch_summary', { total, started, notStarted: notStarted.length, items }, { locale }); // telegram-markdown-ok: counts are numbers; items are escaped above
}

/**
 * Start every link of a batch, one at a time.
 *
 * @param {Object} params
 * @param {string[]} params.urls - Links to start, in order
 * @param {string[]} [params.invalidLinks] - GitHub links that are not issue or pull request links
 * @param {string[]} params.optionArgs - Command options shared by every link
 * @param {(args: string[], reject: Function) => Promise<{ started: boolean }>} params.launch -
 *   Runs the single-link flow; it calls `reject(text, { scope, summary })` instead of replying with an error.
 * @param {(text: string) => Promise<unknown>} params.reply - Replies to the command message
 * @param {(url: string) => string} params.validateLink - Short Markdown reason a link in `invalidLinks` is not started
 * @param {() => boolean} [params.isStopped] - True once the chat is stopped (/stop); the rest is not started
 * @param {Function} [params.sleep]
 * @param {Function} [params.pickDelayMs]
 * @param {string|null} [params.locale]
 * @param {Function} [params.log]
 * @returns {Promise<{ started: string[], notStarted: Array<{ url: string, reason: string }>, optionsError: string|null, summary: string|null }>}
 */
export async function runSolveBatch({ urls, invalidLinks = [], optionArgs, launch, reply, validateLink, isStopped = () => false, sleep = defaultSleep, pickDelayMs = pickSolveBatchDelayMs, locale = null, log = () => {} }) {
  const started = [];
  const notStarted = [];
  let optionsError = null;

  for (let index = 0; index < urls.length; index++) {
    const url = urls[index];
    if (isStopped()) {
      for (const rest of urls.slice(index)) notStarted.push({ url: rest, reason: t('telegram.solve_batch_chat_stopped', {}, { locale }) });
      break;
    }
    let rejection = null;
    const reject = (text, { scope = SOLVE_REJECT_SCOPE.TARGET, summary = null } = {}) => {
      rejection = { text, scope, summary: summary || summarizeRejection(text) };
      return { started: false };
    };
    log(`[solve batch] ${index + 1}/${urls.length}: ${url}`);
    let result;
    try {
      result = await launch([url, ...optionArgs], reject);
    } catch (error) {
      // One broken link must not cost the links after it.
      log(`[solve batch] ${url} failed: ${error?.stack || error}`);
      rejection = { scope: SOLVE_REJECT_SCOPE.TARGET, summary: t('telegram.solve_batch_launch_failed', { error: escapeMarkdown(String(error?.message || error)) }, { locale }) };
      result = { started: false };
    }
    if (rejection?.scope === SOLVE_REJECT_SCOPE.OPTIONS) {
      // Every link would fail the same way: answer once and start nothing more.
      optionsError = rejection.text;
      await reply(rejection.text);
      return { started, notStarted, optionsError, summary: null };
    }
    if (result?.started) {
      started.push(url);
      const remaining = urls.length - index - 1;
      if (remaining > 0) {
        const delayMs = pickDelayMs();
        log(`[solve batch] started ${url}; next link in ${delayMs} ms`);
        await sleep(delayMs);
      }
    } else {
      notStarted.push({ url, reason: rejection?.summary || '—' });
    }
  }

  for (const link of invalidLinks) notStarted.push({ url: link, reason: validateLink(link) });

  let summary = null;
  if (notStarted.length > 0) {
    summary = buildSolveBatchSummary({ total: urls.length + invalidLinks.length, started: started.length, notStarted, locale });
    await reply(summary);
  }
  return { started, notStarted, optionsError, summary };
}
