/* global console */
// PR #4083 feedback: audit the non-solve prompts (organize, task split, task plan)
// for single-line prompts and markdown syntax.
import { ORGANIZE_SYSTEM_PROMPT, buildOrganizationPrompts } from '../src/organize.prompts.lib.mjs';
import { buildTaskSplitPrompt, buildTaskSplitSystemPrompt } from '../src/task.split.lib.mjs';

const issue = { owner: 'o', repo: 'r', number: 1, url: 'https://github.com/o/r/issues/1', title: 'T', body: 'Body' };
const org = buildOrganizationPrompts({ repository: { fullName: 'o/r', url: 'https://github.com/o/r' }, issueTypes: [{ name: 'Bug' }], labels: [{ name: 'bug' }], issues: [{ number: 1, title: 'T', body: 'B', labels: [] }] });
const samples = {
  'organize system': ORGANIZE_SYSTEM_PROMPT,
  'organize user': org.user,
  'task-split system': buildTaskSplitSystemPrompt(),
  'task-split user': buildTaskSplitPrompt({ issue, splitCount: 3 }),
};
const markdown = [/^#{1,6} /m, /\*\*[^*\n]+\*\*/, /\[[^\]\n]+\]\([^)\n]+\)/, /^\s*\|.*\|\s*$/m];
for (const [name, text] of Object.entries(samples)) {
  const lines = text.split('\n');
  console.log(`${name.padEnd(18)} lines=${lines.length} chars=${text.length} longest=${Math.max(...lines.map(l => l.length))} markdown=${markdown.some(re => re.test(text))}`);
  console.log(`---BEGIN ${name}---\n${text.slice(0, 1500)}\n---END---`);
}
