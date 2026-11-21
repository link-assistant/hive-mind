#!/usr/bin/env node
// Issue #3326: check which repositories accept `gh issue create --type`.
// Usage: node experiments/issue-3326-issue-type-preflight.mjs owner/repo [Type]
// `gh issue create --type` creates the issue first and resolves the type
// afterwards, so an unsupported type leaves an issue behind while gh exits 1.
import { getRepositoryIssueTypes, resolveSupportedIssueType } from '../src/task.issue-creation.lib.mjs';

const [fullName = 'konard/medical-neural-network-ml', issueType = 'Bug'] = process.argv.slice(2);
const repository = { fullName };
console.log('issue types:', await getRepositoryIssueTypes({ repository }));
console.log('decision:', await resolveSupportedIssueType({ repository, issueType }));
