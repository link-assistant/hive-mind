/** Resolve issue-generation settings using the same boolean parser as /solve. */
import { getLinoYargsFactory } from './cli-arguments.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from './solve.config.lib.mjs';
import { isReportDependenciesIssuesEnabled } from './report-dependencies-issues.prompts.lib.mjs';

export function resolveFixDependencyReporting(args) {
  const argv = getLinoYargsFactory()(args).option('report-dependencies-issues', SOLVE_OPTION_DEFINITIONS['report-dependencies-issues']).exitProcess(false).parseSync();
  return isReportDependenciesIssuesEnabled({ ...argv, updateAllDependencies: true });
}
