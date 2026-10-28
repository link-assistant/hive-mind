import { promptText, localizePromptConstant } from './prompt-text.lib.mjs';
/** Shared dependency feedback instructions and option resolution (issue #2751). */
export const REPORT_DEPENDENCIES_ISSUES_PARAGRAPH = promptText('prompt.system.templates.report-dependencies-issues-prompts.REPORT_DEPENDENCIES_ISSUES_PARAGRAPH.text1', {}, { locale: 'en' });

/** An explicit reporting choice wins; dependency updates otherwise enable it. */
export const isReportDependenciesIssuesEnabled = argv => Boolean(argv?.reportDependenciesIssues ?? argv?.updateAllDependencies);

export const getReportDependenciesIssuesSubPrompt = argv => {
  if (!isReportDependenciesIssuesEnabled(argv)) return '';
  return promptText('prompt.system.templates.report-dependencies-issues-prompts.getReportDependenciesIssuesSubPrompt.text2', { REPORT_DEPENDENCIES_ISSUES_PARAGRAPH: String(localizePromptConstant(REPORT_DEPENDENCIES_ISSUES_PARAGRAPH)) });
};
