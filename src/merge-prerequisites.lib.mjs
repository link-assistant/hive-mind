#!/usr/bin/env node
/**
 * Issue #4082 (case 6): merge-order prerequisites declared for a pull request.
 *
 * A session summary said "merge the companion PR in the other repository
 * first", and hive-mind still posted "✅ Ready to merge" with only "CI passed,
 * no conflicts, no uncommitted changes". A reader of that final status comment
 * would merge in the wrong order.
 *
 * This module finds such declarations in the pull request description and in
 * the latest working session summary, then checks each referenced pull
 * request or issue:
 *   - a pull request is satisfied only once it is merged;
 *   - an issue is satisfied once it is closed;
 *   - a reference whose state cannot be read stays unsatisfied;
 *   - a declaration without any link ("merge the companion PR first") cannot
 *     be checked, so it stays unsatisfied and is named for a human.
 *
 * Related: #3924, #3911.
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 */

import { isAutomatedWorkingSessionSummaryComment, WORKING_SESSION_SUMMARY_MARKER } from './tool-comments.lib.mjs';

// Phrases that declare an order even without a link. Each is imperative or
// modal ("must be merged first"), so a past-tense report such as "I merged the
// default branch first" does not match.
// Sentence text: a dot only ends a sentence when whitespace or the end follows, so URLs (github.com) stay inside.
const SENTENCE_CHAR = String.raw`(?:[^.;\n]|\.(?!\s|$))`;
const LINK_OPTIONAL_PATTERNS = [
  // "Merge the companion PR in the other repository first", "please merge #12 first"
  new RegExp(String.raw`(?:^|[.;:!?]\s+|^\s*(?:[-*+]|\d+[.)])\s+|\b(?:please|then|and|so)\s+)merge\s+(?!this\b|it\b)${SENTENCE_CHAR}{1,160}?\s+first\b`, 'i'),
  // "#12 must be merged first", "needs to be merged before this one"
  /\b(?:must|needs?\s+to|should|has\s+to|have\s+to|is\s+to)\s+(?:be\s+)?merged\s+(?:first|before)\b/i,
  // "Merge this PR only after ...", "merge it after"
  /\bmerge\s+(?:this|it)\s+(?:pr\s+|pull\s+request\s+|one\s+)?(?:only\s+)?after\b/i,
];
// "Do not merge before #12", "don't merge until the companion PR lands"
const DO_NOT_MERGE_BEFORE_PATTERN = new RegExp(String.raw`\b(?:do\s+not|don'?t|never)\s+merge\b${SENTENCE_CHAR}{0,120}?\b(?:before|until)\b`, 'i');
// Phrases too common in ordinary prose ("the result depends on the flag") to
// count without a link: they only count when the same line names a reference.
const LINK_REQUIRED_PATTERNS = [/\bdepends\s+on\b/i, /\bdependent\s+on\b/i, /\bblocked\s+(?:by|on)\b/i, new RegExp(String.raw`\bafter\s+${SENTENCE_CHAR}{1,160}?\s+(?:is|are|has\s+been|have\s+been|gets|get)\s+merged\b`, 'i'), /\bprerequisites?\b/i, /\brequires\s+merging\b/i];
const NEGATION_PATTERN = /\b(?:no|not|never|without|none|nothing)\b|n't\b/i;

const URL_REFERENCE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/(\d+)\b/gi;
const QUALIFIED_REFERENCE = /(?:^|[^\w/.-])([\w.-]+)\/([\w.-]+)#(\d+)\b/g;
const LOCAL_REFERENCE = /(?:^|[^\w/#&])#(\d+)\b/g;

const MAX_DECLARATION_LENGTH = 200;

/** Prose lines only: fenced code, quoted text (often the issue being quoted), HTML comments and inline code are dropped. */
const proseLines = text => {
  const lines = [];
  let inFence = false;
  const withoutComments = String(text || '').replace(/<!--[\s\S]*?-->/g, '');
  for (const raw of withoutComments.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*>/.test(raw)) continue;
    const line = raw.replace(/`[^`\n]*`/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines;
};

/** References named in a line, as `{ owner, repo, number }` (the pull request's own repository for a bare `#N`). */
export const extractReferences = (line, { owner, repo } = {}) => {
  const references = [];
  const seen = new Set();
  const add = (refOwner, refRepo, number) => {
    if (!refOwner || !refRepo || !number) return;
    const key = `${refOwner.toLowerCase()}/${refRepo.toLowerCase()}#${number}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ owner: refOwner, repo: refRepo, number: Number(number) });
  };
  let rest = String(line || '');
  for (const match of rest.matchAll(URL_REFERENCE)) add(match[1], match[2], match[3]);
  rest = rest.replace(URL_REFERENCE, ' ');
  for (const match of rest.matchAll(QUALIFIED_REFERENCE)) add(match[1], match[2], match[3]);
  rest = rest.replace(QUALIFIED_REFERENCE, ' ');
  for (const match of rest.matchAll(LOCAL_REFERENCE)) add(owner, repo, match[1]);
  return references;
};

const matchDeclaration = line => {
  const doNotMerge = line.match(DO_NOT_MERGE_BEFORE_PATTERN);
  if (doNotMerge) return { index: doNotMerge.index, linkRequired: false };
  for (const [patterns, linkRequired] of [
    [LINK_OPTIONAL_PATTERNS, false],
    [LINK_REQUIRED_PATTERNS, true],
  ]) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      // "This does not need to be merged first", "no dependencies": a negation before the phrase cancels it.
      if (NEGATION_PATTERN.test(line.slice(0, match.index + match[0].length))) continue;
      return { index: match.index, linkRequired };
    }
  }
  return null;
};

const shorten = line => (line.length > MAX_DECLARATION_LENGTH ? `${line.slice(0, MAX_DECLARATION_LENGTH)}...` : line);

/**
 * Merge-order declarations in a text.
 *
 * @param {string} text - pull request description or session summary
 * @param {Object} context - `{ owner, repo, selfNumbers }`; `selfNumbers` are this pull request and its issue, never prerequisites
 * @returns {Array<{ text: string, references: Array<{owner, repo, number}> }>}
 */
export const findMergePrerequisiteDeclarations = (text, { owner, repo, selfNumbers = [] } = {}) => {
  const self = new Set(selfNumbers.filter(Boolean).map(Number));
  const isSelf = ref => ref.owner?.toLowerCase() === String(owner || '').toLowerCase() && ref.repo?.toLowerCase() === String(repo || '').toLowerCase() && self.has(ref.number);
  const declarations = [];
  for (const line of proseLines(text)) {
    const declaration = matchDeclaration(line);
    if (!declaration) continue;
    // Issue-closing lines ("Fixes #12") are never prerequisites, even when they mention one.
    if (/^\s*(?:[-*+]\s+)?(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b/i.test(line)) continue;
    const references = extractReferences(line, { owner, repo }).filter(ref => !isSelf(ref));
    if (references.length === 0 && declaration.linkRequired) continue;
    declarations.push({ text: shorten(line), references });
  }
  return declarations;
};

/** The body of the latest working session summary comment, or ''. */
export const latestSessionSummary = comments => {
  const summaries = (Array.isArray(comments) ? comments : []).filter(comment => isAutomatedWorkingSessionSummaryComment(comment?.body) || String(comment?.body || '').includes(`## ${WORKING_SESSION_SUMMARY_MARKER}`));
  return summaries.length > 0 ? String(summaries[summaries.length - 1].body || '') : '';
};

const readJson = async (commandRunner, run) => {
  try {
    const result = await run(commandRunner);
    if (result?.code !== 0) return null;
    return JSON.parse(result.stdout.toString() || 'null');
  } catch {
    return null;
  }
};

/** State of a referenced pull request or issue: `{ kind, state, resolved, url, title }`. */
export const checkReferenceState = async (reference, commandRunner) => {
  const data = await readJson(commandRunner, run => run`gh api repos/${reference.owner}/${reference.repo}/issues/${reference.number}`);
  const fallbackUrl = `https://github.com/${reference.owner}/${reference.repo}/issues/${reference.number}`;
  if (!data || typeof data !== 'object') return { ...reference, kind: 'unknown', state: 'unknown', resolved: false, url: fallbackUrl, title: null };
  const isPullRequest = Boolean(data.pull_request);
  const merged = Boolean(data.pull_request?.merged_at);
  const state = isPullRequest ? (merged ? 'merged' : data.state) : data.state;
  return { ...reference, kind: isPullRequest ? 'pull request' : 'issue', state: state || 'unknown', resolved: isPullRequest ? merged : data.state === 'closed', url: data.html_url || fallbackUrl, title: data.title || null };
};

/**
 * Declared merge prerequisites of a pull request and whether each is satisfied.
 *
 * @returns {Promise<{ ok: boolean, prerequisites: Array, unresolved: Array }>} each prerequisite is
 *   `{ source, text, references: Array<{ ...state }>, resolved }`.
 */
export const checkMergePrerequisites = async ({ owner, repo, prNumber, issueNumber, commandRunner }) => {
  const context = { owner, repo, selfNumbers: [prNumber, issueNumber] };
  const pullRequest = await readJson(commandRunner, run => run`gh api repos/${owner}/${repo}/pulls/${prNumber}`);
  const comments = await readJson(commandRunner, run => run`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`);
  const sources = [
    { source: 'pull request description', text: pullRequest?.body || '' },
    { source: 'working session summary', text: latestSessionSummary(comments) },
  ];
  const prerequisites = [];
  const stateCache = new Map();
  for (const { source, text } of sources) {
    for (const declaration of findMergePrerequisiteDeclarations(text, context)) {
      const references = [];
      for (const reference of declaration.references) {
        const key = `${reference.owner}/${reference.repo}#${reference.number}`.toLowerCase();
        if (!stateCache.has(key)) stateCache.set(key, await checkReferenceState(reference, commandRunner));
        references.push(stateCache.get(key));
      }
      // A declaration without a link cannot be checked: a human has to confirm it.
      const resolved = references.length > 0 && references.every(reference => reference.resolved);
      prerequisites.push({ source, text: declaration.text, references, resolved });
    }
  }
  return { ok: pullRequest !== null, prerequisites, unresolved: prerequisites.filter(prerequisite => !prerequisite.resolved) };
};

const describeReference = reference => `[${reference.owner}/${reference.repo}#${reference.number}](${reference.url}) is ${reference.state === 'unknown' ? 'in an unknown state (it could not be read)' : reference.state === 'merged' ? 'merged' : reference.kind === 'pull request' ? `${reference.state} and not merged` : reference.state}`;

/** Markdown list items naming each unsatisfied prerequisite. */
export const formatPrerequisitesForComment = prerequisites =>
  (prerequisites || []).map(prerequisite => {
    const open = prerequisite.references.filter(reference => !reference.resolved);
    const detail = open.length > 0 ? open.map(describeReference).join('; ') : 'no link to check, so confirm it manually';
    return `- Declared in the ${prerequisite.source}: "${prerequisite.text}" — ${detail}`;
  });

export default {
  findMergePrerequisiteDeclarations,
  extractReferences,
  latestSessionSummary,
  checkReferenceState,
  checkMergePrerequisites,
  formatPrerequisitesForComment,
};
