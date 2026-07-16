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
    lines.push(isBug ? `Download all logs and collect data related about the issue to this repository, and compile that data into the ${directory} folder.` : `Collect data related about the issue to this repository, and compile that data into the ${directory} folder.`);
  }

  if (isBug) {
    lines.push('Use the collected evidence to do a deep analysis (search online for additional facts and data), reconstruct the timeline/sequence of events, list each and every requirement from the issue, find the root cause of each problem, and propose possible solutions and solution plans for each requirement. Also check online for known existing components/libraries that solve a similar problem or can help.', 'If there is not enough data to find the actual root cause, add debug output and a verbose mode (if not already present) so the root cause can be found on the next iteration. Keep the default state switched off.', 'If the issue is related to another repository/project, report issues on GitHub for that project when possible. Each report must contain reproducible examples, workarounds, and suggestions for fixing the issue in code.');
  } else {
    lines.push('Do a deep analysis (search online for additional facts and data), list each and every requirement from the issue, and propose possible solutions and solution plans for each requirement. Also check online for known existing components/libraries that solve a similar problem or can help.');
  }

  lines.push('Double-check that the requirements are fully applied to the entire codebase: if an issue exists in multiple places, apply it in all of them.');
  return `\n${lines.join('\n\n')}\n`;
};

// Development-log and deep-analysis instructions occupy the same position in
// the initial user prompt. Selecting deep analysis subsumes the shorter
// development-log sentence so it is not duplicated when both flags are used.
export const buildIssueResearchPrompt = params => {
  const deepAnalysisPrompt = buildDeepAnalysisPrompt(params);
  return deepAnalysisPrompt || buildDevelopmentLogPrompt(params);
};
