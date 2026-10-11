/** Preview dependency reporting settings and issue text without GitHub writes. */
import { resolveFixDependencyReporting } from '../src/fix.report-dependencies.lib.mjs';
import { buildUpdateDependenciesIssueBody } from '../src/fix.update-dependencies.lib.mjs';

const reportDependenciesIssues = resolveFixDependencyReporting(process.argv.slice(2));
console.log(
  buildUpdateDependenciesIssueBody({
    repository: { fullName: 'owner/repo', url: 'https://github.com/owner/repo' },
    defaultBranch: 'main',
    languages: { JavaScript: 100 },
    files: ['package.json'],
    reportDependenciesIssues,
  })
);
