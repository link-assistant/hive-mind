/** Evaluate a draft PR description with the shared guard's evaluator against live data (read-only). */
import { readFile } from 'node:fs/promises';
import { fetchRequirementsSnapshot } from '../../src/issue-completion.lib.mjs';
import { evaluateRequirementsReport, missingIssueLinks } from '../../src/issue-requirements.lib.mjs';

const [repository, issueNumber, prNumber, bodyFile] = process.argv.slice(2);
const [owner, repo] = repository.split('/');
const { headSha, issues } = await fetchRequirementsSnapshot({ owner, repo, issueNumber, prNumber });
const prBody = await readFile(bodyFile, 'utf8');
console.log(JSON.stringify({ headSha, missingLinks: missingIssueLinks(prBody, issues, { owner, repo }), blocker: evaluateRequirementsReport({ prBody, headSha, issues }) }, null, 2));
