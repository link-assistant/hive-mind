/** Count executed attempts rather than green workflows that skipped the model. */
export function assessDraftActivity({ issues = [], runs = [], jobsByRun = {}, since } = {}) {
  const cutoff = Date.parse(since);
  const eligibleIssues = issues.filter(issue => Date.parse(issue.created_at) >= cutoff && !issue.pull_request && issue.user?.type !== 'Bot' && !(issue.labels || []).some(label => (typeof label === 'string' ? label : label.name)?.toLowerCase() === 'no-formal-ai-draft'));
  const executed = runs.filter(run => Date.parse(run.created_at) >= cutoff && (jobsByRun[run.id] || []).some(job => (job.steps || []).some(step => step.name === 'Open the Formal AI draft' && (step.status === 'in_progress' || (step.status === 'completed' && (['success', 'failure'].includes(step.conclusion) || (step.conclusion === 'cancelled' && Boolean(step.started_at))))))));
  return { eligibleIssues, executed, ok: eligibleIssues.length === 0 || executed.length > 0 };
}
