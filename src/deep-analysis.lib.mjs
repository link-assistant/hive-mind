import { promptText } from './prompt-text.lib.mjs';
import { buildDevelopmentLogDirectory, buildDevelopmentLogPrompt, isBugIssueType, isDevelopmentLogEnabled } from './development-log.lib.mjs';

export const isDeepAnalysisEnabled = argv => argv?.deepAnalysis === true || argv?.['deep-analysis'] === true;

export const buildDeepAnalysisPrompt = ({ argv, issueNumber, prNumber, issueType }) => {
  if (!isDeepAnalysisEnabled(argv)) return '';

  const resolvedIssueType = issueType ?? argv?.issueType ?? null;
  const isBug = isBugIssueType(resolvedIssueType);
  const lines = [];

  // Issue #1596 owns development-log collection. Deep analysis may refer to
  // that directory, but must never activate logging by itself.
  if (isDevelopmentLogEnabled(argv)) {
    const directory = buildDevelopmentLogDirectory({ issueNumber, prNumber });
    lines.push(isBug ? promptText('prompt.templates.deep-analysis.buildDeepAnalysisPrompt.text1', { directory: String(directory) }) : promptText('prompt.templates.deep-analysis.buildDeepAnalysisPrompt.text2', { directory: String(directory) }));
  }

  if (isBug) {
    lines.push(promptText('prompt.templates.deep-analysis.buildDeepAnalysisPrompt.text3'), promptText('prompt.templates.deep-analysis.buildDeepAnalysisPrompt.text4'), promptText('prompt.templates.deep-analysis.buildDeepAnalysisPrompt.text5'));
  } else {
    lines.push(promptText('prompt.templates.deep-analysis.buildDeepAnalysisPrompt.text6'));
  }

  lines.push(promptText('prompt.templates.deep-analysis.buildDeepAnalysisPrompt.text7'));
  return `\n${lines.join('\n\n')}\n`;
};

// Development-log and deep-analysis instructions occupy the same position in
// the initial user prompt. Selecting deep analysis subsumes the shorter
// development-log sentence so it is not duplicated when both flags are used.
export const buildIssueResearchPrompt = params => {
  const deepAnalysisPrompt = buildDeepAnalysisPrompt(params);
  return deepAnalysisPrompt || buildDevelopmentLogPrompt(params);
};
