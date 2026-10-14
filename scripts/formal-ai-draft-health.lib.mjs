/** Pure health decision for the scheduled Formal AI draft check (issues #2323, #2324). */
import { decideDraft, DRAFT_DECISION_ANNOTATION_TITLE, DRAFT_DECISION_CODES, DRAFT_FAILURE_ANNOTATION_TITLE } from './formal-ai-draft.lib.mjs';

export const DRAFT_STEP = 'Open the Formal AI draft';

/** Issues opened since `since` that the draft workflow would attempt. */
export const eligibleIssues = (issues, since) => issues.filter(issue => issue.created_at >= since && decideDraft({ action: 'opened', issue: { ...issue, labels: (issue.labels || []).filter(label => label.name !== 'formal-ai-draft') } }).run);

/** A run counts only when its model step actually started; a green run with a skipped step is not an attempt. */
export const isExecutedAttempt = (run, jobs) => ['issues', 'workflow_dispatch'].includes(run.event) && jobs.some(job => job.steps?.some(step => step.name === DRAFT_STEP && step.started_at && step.conclusion !== 'skipped'));

export function evaluateDraftHealth({ eligible, attempts }) {
  return {
    healthy: !(eligible > 0 && attempts === 0),
    report: `Formal AI draft health (7 days): ${eligible} eligible issues, ${attempts} executed attempts.`,
  };
}

/**
 * A draft that fails the same way every time is not healthy either: dozens of
 * drafts once failed on one known error while this check, counting attempts
 * only, stayed green. These read the decision and the first error each draft
 * job records as annotations and fail on a repeat.
 */
export const REPEATED_FAILURE_THRESHOLD = 5;

/** Decisions that are the policy working, not a fault: they neither count nor break a streak. */
const POLICY_SKIPS = new Set([DRAFT_DECISION_CODES.notOpened, DRAFT_DECISION_CODES.pullRequest, DRAFT_DECISION_CODES.botAuthor, DRAFT_DECISION_CODES.optOut, DRAFT_DECISION_CODES.alreadyDrafted]);
const NO_RECORDED_ERROR = 'failure with no recorded first error';
const DECISION_PREFIX = 'decision_code ';

/** An error message without the parts that differ per run (ids, paths, durations), so repeats compare equal. */
export const normalizeErrorKey = message =>
  String(message || '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '…')
    .replace(/\b0x[0-9a-f]+\b/gi, '…')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi, '…')
    .replace(/\d{4,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

/**
 * What one draft run recorded about itself.
 *
 * @param {object} run a workflow run
 * @param {object[]} annotations the draft job's check-run annotations
 */
export function runOutcomeFromAnnotations(run, annotations) {
  const titled = title => (annotations || []).find(annotation => annotation.title === title)?.message ?? null;
  return { url: run.html_url, createdAt: run.created_at, status: run.status, conclusion: run.conclusion, decisionCode: titled(DRAFT_DECISION_ANNOTATION_TITLE), firstError: titled(DRAFT_FAILURE_ANNOTATION_TITLE) };
}

/** `undefined`: neutral; `null`: healthy; a string: the fault this run repeats. */
const faultKey = outcome => {
  if (outcome.status !== 'completed' || outcome.conclusion === 'cancelled') return undefined;
  if (POLICY_SKIPS.has(outcome.decisionCode)) return undefined;
  if (outcome.conclusion === 'success' || outcome.conclusion === 'skipped' || outcome.conclusion === 'neutral') {
    return outcome.decisionCode && outcome.decisionCode !== DRAFT_DECISION_CODES.run ? `${DECISION_PREFIX}${outcome.decisionCode}` : null;
  }
  return outcome.firstError ? normalizeErrorKey(outcome.firstError) : NO_RECORDED_ERROR;
};

/**
 * The fault the newest runs share, when at least `threshold` of them in a row do.
 *
 * @param {object[]} outcomes from runOutcomeFromAnnotations, in any order
 * @param {{threshold?: number}} [options]
 * @returns {{key: string, count: number, runs: string[]}|null} runs newest first
 */
export function findRepeatedFailure(outcomes, { threshold = REPEATED_FAILURE_THRESHOLD } = {}) {
  const newestFirst = [...outcomes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  let key;
  const runs = [];
  for (const outcome of newestFirst) {
    const fault = faultKey(outcome);
    if (fault === undefined) continue;
    if (fault === null || (key !== undefined && fault !== key)) break;
    key = fault;
    runs.push(outcome.url);
  }
  return key !== undefined && runs.length >= threshold ? { key, count: runs.length, runs } : null;
}

/** The text to look for in open issues: the decision code, or the longest literal part of the error. */
export const trackingIssueSearchPhrase = key => {
  if (key.startsWith(DECISION_PREFIX)) return key.slice(DECISION_PREFIX.length);
  if (key === NO_RECORDED_ERROR) return null;
  return (
    key
      .split('…')
      .reduce((longest, part) => (part.trim().length > longest.trim().length ? part : longest), '')
      .trim() || null
  );
};

/**
 * @param {{key: string, count: number, runs: string[]}} streak
 * @param {{number: number, title: string, html_url: string}|null} issue an open issue that mentions it
 */
export function formatRepeatedFailureReport(streak, issue) {
  const what = streak.key.startsWith(DECISION_PREFIX) ? `ended with the same ${streak.key}` : `failed with the same first error: ${streak.key}`;
  const tracking = issue ? `Tracking issue: #${issue.number} ${issue.title} (${issue.html_url})` : 'No open issue mentions it; open one so the failure is tracked.';
  return [`The last ${streak.count} draft runs ${what}`, tracking, 'Runs, newest first:', ...streak.runs.map(url => `- ${url}`)].join('\n');
}
