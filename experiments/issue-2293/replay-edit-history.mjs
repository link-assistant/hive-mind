#!/usr/bin/env node
// Issue #2293: replay the real edit history + comments of a pull request through the
// new detector (edit history + solver session windows) and print every edit that would
// still be reported as human feedback.
//
// Usage: node replay-edit-history.mjs <prefix>   (e.g. ml-196, rml-184)
// Data:  gh api graphql -f query="$CONTENT_EDITS_QUERY" -f owner=... -f repo=... -F number=N > <prefix>-edits.json
//        gh api repos/OWNER/REPO/issues/N/comments --paginate > <prefix>-comments.json
import { readFileSync } from 'node:fs';
import { buildSolverSessionWindows, classifyContentEdits, formatEditEvidence, parseContentEdits } from '../../src/description-edits.lib.mjs';

const prefix = process.argv[2] || 'ml-196';
const dir = new URL('.', import.meta.url);
const node = JSON.parse(readFileSync(new URL(`${prefix}-edits.json`, dir))).data.repository.issueOrPullRequest;
const comments = JSON.parse(readFileSync(new URL(`${prefix}-comments.json`, dir)));
const edits = parseContentEdits(node);
const windows = buildSolverSessionWindows(comments, { openedAt: node.createdAt });
const { external, ignored } = classifyContentEdits({ edits, since: node.createdAt, windows, currentUser: 'konard' });
console.log(`${prefix}: ${windows.length} solver session windows, ${edits.length} edits, ${ignored.length} ignored (solver/bot), ${external.length} external`);
for (const edit of external) console.log(`  EXTERNAL ${formatEditEvidence(edit)}`);
if (process.env.VERBOSE) for (const { edit, reason } of ignored) console.log(`  ignored ${formatEditEvidence(edit)} - ${reason}`);
