/** Shared dependency feedback instructions and option resolution (issue #2751). */
export const REPORT_DEPENDENCIES_ISSUES_PARAGRAPH = 'Report to each dependency’s upstream all general logic or duplicated code that belongs in that dependency, missing features, and bugs that lead to workarounds in this repository. Search existing upstream issues first, then create or update a report with a minimal reproducible example, affected versions, the local workaround, and a suggested fix in code or feature proposal; link every report from the pull request. Keep necessary workarounds in this repository so upstream fixes do not block the pull request.';

/** An explicit reporting choice wins; dependency updates otherwise enable it. */
export const isReportDependenciesIssuesEnabled = argv => Boolean(argv?.reportDependenciesIssues ?? argv?.updateAllDependencies);

export const getReportDependenciesIssuesSubPrompt = argv => {
  if (!isReportDependenciesIssuesEnabled(argv)) return '';
  return `\n\nDependency issue reporting (--report-dependencies-issues).\n   - ${REPORT_DEPENDENCIES_ISSUES_PARAGRAPH}`;
};
