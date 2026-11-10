import { promptText, localizePromptConstant } from './prompt-text.lib.mjs';
/** Complete-delivery goal shared by every tool's prompts (issue #2406). */
import { fileURLToPath } from 'node:url';

// Defined here, not in issue-requirements.lib.mjs, so prompt modules stay free of GitHub client imports.
export const REQUIREMENTS_START = '<!-- hive-mind:requirements:start -->';
export const REQUIREMENTS_END = '<!-- hive-mind:requirements:end -->';

const TRUE_VALUES = /^(?:true|1|yes|on)$/i;

/**
 * The requirements report (issue #2406) is experimental and off by default
 * (issue #3469): without --requirements-report, or
 * HIVE_MIND_REQUIREMENTS_REPORT=true for processes that have no command line
 * (the merge queue), no prompt mentions it, no completion restart waits for it
 * and the merge guard checks only the issue links (#2335).
 */
export const isRequirementsReportEnabled = (argv = {}, env = process.env) => (typeof argv?.requirementsReport === 'boolean' ? argv.requirementsReport : TRUE_VALUES.test(String(env?.HIVE_MIND_REQUIREMENTS_REPORT ?? '').trim()));

export const ISSUE_COMPLETION_GOAL = promptText('prompt.system.templates.issue-completion-prompts.ISSUE_COMPLETION_GOAL.text3', {}, { locale: 'en' });

export function getIssueCompletionSubPrompt({ owner, repo, issueNumber, prNumber, argv } = {}) {
  return promptText('prompt.system.templates.issue-completion-prompts.getIssueCompletionSubPrompt.text4', { ISSUE_COMPLETION_GOAL: String(localizePromptConstant(ISSUE_COMPLETION_GOAL)), value2: String(isRequirementsReportEnabled(argv) ? getRequirementsReportSubPrompt({ owner, repo, issueNumber, prNumber }) : '') });
}

/** The experimental requirements report instructions (issue #2406), only with --requirements-report (issue #3469). */
export function getRequirementsReportSubPrompt({ owner, repo, issueNumber, prNumber } = {}) {
  const snapshotPath = fileURLToPath(new URL('./issue-requirements-snapshot.mjs', import.meta.url));
  const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const command = `${quote(process.execPath)} ${quote(snapshotPath)} ${quote(`${owner}/${repo}`)} ${issueNumber || '<issue-number>'} ${prNumber || '<pull-request-number>'}`;
  return promptText('prompt.system.templates.issue-completion-prompts.getRequirementsReportSubPrompt.text5', { command: String(command), REQUIREMENTS_START: String(REQUIREMENTS_START), REQUIREMENTS_END: String(REQUIREMENTS_END) });
}
