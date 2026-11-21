// Lists the comments the requirements digest treats as feedback (src/issue-requirements.lib.mjs).
// Usage: node experiments/issue-3445-list-requirement-feedback.mjs <comments.json>
import { readFileSync } from 'node:fs';
import { requirementFeedback } from '../src/issue-requirements.lib.mjs';
const comments = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const c of requirementFeedback(comments)) console.log(c.id, JSON.stringify(c.body.slice(0, 160)));
