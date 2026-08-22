#!/usr/bin/env node

/**
 * Pure detection + normalization helpers for the keep-working feature.
 *
 * This module intentionally has NO use-m / command-stream / network imports so
 * it can be unit-tested in isolation (mirroring auto-iteration-limits.lib.mjs).
 * The orchestration lives in solve.keep-working.lib.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1883
 */

/**
 * The default number of auto-restarts when the feature is enabled without an
 * explicit count.
 */
export const DEFAULT_KEEP_WORKING_LIMIT = 5;

/**
 * The reinforcement prompt appended to every keep-working restart, in addition
 * to the concrete detected reasons. Taken verbatim from issue #1883.
 */
export const KEEP_WORKING_PROMPT = 'Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.';

/**
 * Strong indicators that work was deferred / delayed / left for a future pull
 * request. These intentionally favour recall over precision: when the user
 * enables --keep-working-until-all-requirements-are-fully-done they explicitly
 * want the AI to keep going, so we accept some false positives (issue #1883).
 *
 * Each entry has a human-readable `label` (shown to the user / AI as the reason
 * for the restart) and a `pattern` (a global, case-insensitive RegExp).
 *
 * IMPORTANT: keep these patterns anchored on deferral semantics so the
 * reinforcement prompt itself ("until it is each and every requirement fully
 * addressed") does NOT match and cause an infinite restart loop.
 */
export const DEFERRED_WORK_PATTERNS = [
  { label: 'out of scope', pattern: /\b(?:out[\s-]of[\s-]scope|beyond\s+the\s+scope|outside\s+the\s+scope|not\s+(?:in|within)\s+(?:the\s+)?scope)\b/gi },
  { label: 'future work', pattern: /\bfuture\s+(?:work|improvements?|enhancements?|iterations?|steps?|considerations?)\b/gi },
  { label: 'future / separate / follow-up pull request', pattern: /\b(?:in\s+a\s+|a\s+)?(?:future|separate|subsequent|later|next|follow[\s-]?up|another)\s+(?:pull\s+request|pr|mr|merge\s+request|change(?:set)?|commit)\b/gi },
  { label: 'follow-up work', pattern: /\bfollow[\s-]?up(?:\s+(?:work|task|item|pr|pull\s+request|issue))?\b/gi },
  { label: 'deferred', pattern: /\bdefer(?:red|ring|s)?\b(?!\s+to\s+the\s+caller)/gi },
  { label: 'delayed / postponed', pattern: /\b(?:delayed|postponed|postpone|deprioriti[sz]ed)\b/gi },
  { label: 'planned for later / another pull request', pattern: /\bplanned\s+for\s+(?:a\s+)?(?:future|later|the\s+next|another|separate|subsequent)\b/gi },
  { label: 'left / leaving for later', pattern: /\ble(?:ft|aving|ave)\s+(?:it\s+|this\s+|that\s+|them\s+)?(?:for\s+(?:later|now|the\s+future)|as\s+(?:a\s+)?(?:future|follow[\s-]?up))/gi },
  { label: 'will be addressed later / separately', pattern: /\b(?:will|to)\s+be\s+(?:addressed|handled|implemented|done|tackled|covered|completed|fixed)\s+(?:later|separately|in\s+(?:a\s+)?(?:future|subsequent|separate|follow[\s-]?up|another|the\s+next))/gi },
  { label: 'not implemented yet', pattern: /\bnot\s+(?:yet\s+)?(?:implemented|done|completed|finished|addressed|supported|covered)(?:\s+yet)?\b/gi },
  { label: 'to be implemented / TBD', pattern: /\b(?:to\s+be\s+(?:implemented|done|added|determined|decided)|tbd|to[\s-]?dos?|fixme)\b/gi },
  { label: 'remaining work / not covered', pattern: /\b(?:remaining\s+(?:work|tasks?|items?)|not\s+covered\s+(?:here|in\s+this\s+(?:pr|pull\s+request|change))|won['’]?t\s+(?:be\s+)?(?:covered|implemented|addressed|done)(?:\s+here)?)\b/gi },
  { label: 'tracked separately / in a separate issue', pattern: /\btrack(?:ed|ing)?\s+(?:this\s+|it\s+|them\s+|separately\s+)?(?:in\s+)?(?:a\s+)?(?:separate|new|future|follow[\s-]?up)\s+(?:issue|ticket|task)\b/gi },
  { label: 'for now / as a stopgap / temporary', pattern: /\b(?:for\s+now|as\s+a\s+(?:stop[\s-]?gap|temporary\s+measure|first\s+step)|in\s+the\s+meantime)\b/gi },
];

const UNLIMITED_KEYWORDS = new Set(['forever', 'unlimited', 'infinite', 'infinity', 'inf', 'no-limit', 'nolimit', 'none', 'always']);

/**
 * Returns true when a raw flag value requests an unlimited number of restarts.
 * @param {*} value
 * @returns {boolean}
 */
export const isUnlimitedKeepWorking = value => {
  if (value === Infinity) return true;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (UNLIMITED_KEYWORDS.has(normalized)) return true;
    if (normalized === '0') return true;
  }
  return false;
};

/**
 * Normalize the --keep-working-until-all-requirements-are-fully-done flag value
 * into a numeric restart limit.
 *
 *  - boolean true (flag without value) -> DEFAULT_KEEP_WORKING_LIMIT (5)
 *  - "forever" / "unlimited" / "infinite" / "0" / 0 -> Infinity (no limit)
 *  - a positive number / numeric string -> floor(value)
 *  - anything invalid -> DEFAULT_KEEP_WORKING_LIMIT (5)
 *  - falsy (undefined / null / false / "") -> 0 (feature disabled)
 *
 * @param {*} value
 * @param {number} [fallback=DEFAULT_KEEP_WORKING_LIMIT]
 * @returns {number} numeric limit (Infinity for unlimited, 0 when disabled)
 */
export const normalizeKeepWorkingLimit = (value, fallback = DEFAULT_KEEP_WORKING_LIMIT) => {
  // Disabled
  if (value === undefined || value === null || value === false || value === '') {
    return 0;
  }

  // Flag provided without a value
  if (value === true) return fallback;

  // Unlimited keywords / 0
  if (isUnlimitedKeepWorking(value)) return Infinity;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;

  return Math.floor(parsed);
};

/**
 * Human readable description of the limit for logs.
 * @param {number} limit
 * @returns {string}
 */
export const formatKeepWorkingLimit = limit => (limit === Infinity ? 'unlimited' : `${limit}`);

/**
 * Scan a single block of text for deferred-work indicators.
 *
 * @param {string} text - the text to scan
 * @param {string} [source='text'] - a label describing where the text came from
 * @returns {Array<{label: string, match: string, snippet: string, source: string}>}
 */
export const detectDeferredWork = (text, source = 'text') => {
  if (!text || typeof text !== 'string') return [];

  const detections = [];
  const seen = new Set();

  for (const { label, pattern } of DEFERRED_WORK_PATTERNS) {
    // Reset lastIndex because patterns are global and reused across calls.
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const matchedText = match[0];
      // Build a short snippet around the match for context.
      const start = Math.max(0, match.index - 40);
      const end = Math.min(text.length, match.index + matchedText.length + 40);
      const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();

      // De-duplicate identical (label + snippet) hits within a single source.
      const key = `${label}::${snippet.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        detections.push({ label, match: matchedText, snippet, source });
      }

      // Guard against zero-length matches causing an infinite loop.
      if (pattern.lastIndex === match.index) pattern.lastIndex++;
    }
    pattern.lastIndex = 0;
  }

  return detections;
};

/**
 * Run all configured sources through the detector and return a flat list of
 * detections.
 *
 * @param {Array<{source: string, text: string}>} sources
 * @returns {Array<{label: string, match: string, snippet: string, source: string}>}
 */
export const detectDeferredWorkInSources = sources => {
  const detections = [];
  for (const { source, text } of sources || []) {
    detections.push(...detectDeferredWork(text, source));
  }
  return detections;
};

/**
 * Extract the added lines (lines beginning with "+") from a unified diff patch.
 * @param {string} patch
 * @returns {string}
 */
export const extractAddedLinesFromPatch = patch => {
  if (!patch || typeof patch !== 'string') return '';
  return patch
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1))
    .join('\n');
};

/**
 * Build the feedback lines for a keep-working restart iteration.
 *
 * @param {Array<{label, snippet, source}>} detections
 * @param {number} iteration
 * @param {number} limit
 * @returns {string[]}
 */
export const buildKeepWorkingFeedback = (detections, iteration, limit) => {
  const limitLabel = formatKeepWorkingLimit(limit);
  const lines = ['', '='.repeat(60), `🔁 KEEP WORKING UNTIL ALL REQUIREMENTS ARE FULLY DONE (restart ${iteration}/${limitLabel}):`, '='.repeat(60), '', 'It looks like some work was deferred, delayed or planned for a future pull request.', 'The following strong indicators of unfinished / deferred work were detected:', ''];

  // Show up to 15 distinct detected reasons to keep the prompt focused.
  const shown = (detections || []).slice(0, 15);
  for (const detection of shown) {
    lines.push(`  • [${detection.label}] in ${detection.source}: "${detection.snippet}"`);
  }
  if ((detections || []).length > shown.length) {
    lines.push(`  • ...and ${detections.length - shown.length} more indicator(s)`);
  }

  lines.push('');
  lines.push('There is NO future pull request. This is the single pull request where everything must be done.');
  lines.push('Do not defer, delay or postpone anything. Remove any "future work" / "out of scope" / "TODO" / "follow-up" notes by actually implementing them now.');
  lines.push('');
  lines.push(KEEP_WORKING_PROMPT);
  lines.push('');

  return lines;
};

export default {
  DEFAULT_KEEP_WORKING_LIMIT,
  KEEP_WORKING_PROMPT,
  DEFERRED_WORK_PATTERNS,
  isUnlimitedKeepWorking,
  normalizeKeepWorkingLimit,
  formatKeepWorkingLimit,
  detectDeferredWork,
  detectDeferredWorkInSources,
  extractAddedLinesFromPatch,
  buildKeepWorkingFeedback,
};
