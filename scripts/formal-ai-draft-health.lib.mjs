/** Pure health decision for the scheduled Formal AI draft check (issues #2323, #2324). */
import { decideDraft } from './formal-ai-draft.lib.mjs';

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
