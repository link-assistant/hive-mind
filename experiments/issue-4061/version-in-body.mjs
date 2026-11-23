// Issue #4061: show the "Collected by" line the issue body now carries.
import { buildUpdateDependenciesIssueBody } from '../../src/fix.update-dependencies.lib.mjs';
const body = buildUpdateDependenciesIssueBody({ repository: { fullName: 'owner/repo', url: 'https://github.com/owner/repo' }, defaultBranch: 'main', commit: null, languages: {}, files: [], toolVersion: '2.40.0' });
console.log(
  body
    .split('\n')
    .filter(line => /Collected by|Manifest files/.test(line))
    .join('\n')
);
