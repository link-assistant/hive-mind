#!/usr/bin/env node
/** Print a fresh report template without inventing completion evidence. */
import { fetchRequirementsSnapshot } from './issue-completion.lib.mjs';
import { createRequirementsReportTemplate, formatRequirementsReport } from './issue-requirements.lib.mjs';

const [repository, issueNumber, prNumber] = process.argv.slice(2);
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[1-9]\d*$/.test(issueNumber || '') || !/^[1-9]\d*$/.test(prNumber || '')) {
  console.error('Usage: node issue-requirements-snapshot.mjs OWNER/REPO ISSUE_NUMBER PR_NUMBER');
  process.exitCode = 1;
} else {
  try {
    const [owner, repo] = repository.split('/');
    const { headSha, issues } = await fetchRequirementsSnapshot({ owner, repo, issueNumber, prNumber });
    const report = createRequirementsReportTemplate({ headSha, issues });
    console.log(formatRequirementsReport(report));
  } catch (error) {
    console.error(`Cannot prepare requirements report: ${error.message}`);
    process.exitCode = 1;
  }
}
