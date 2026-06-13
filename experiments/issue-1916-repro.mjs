import { resolveTaskIssueCreationInput, parseTaskIssueCreationInput } from '../src/task.issue-creation.lib.mjs';

const cases = [
  { name: 'reply: repo inline, issue text in reply', commandText: '/task https://github.com/link-assistant/formal-ai', replyText: 'Issue text here\nSecond line.' },
  { name: 'reply: nothing inline, repo+issue in reply', commandText: '/task', replyText: 'https://github.com/link-assistant/formal-ai\nIssue text here' },
  { name: 'inline only: repo+issue', commandText: '/task https://github.com/link-assistant/formal-ai\nIssue text here', replyText: '' },
  { name: 'reply: issue inline, repo in reply', commandText: '/task Issue text here', replyText: 'https://github.com/link-assistant/formal-ai' },
  { name: 'reply: same repo inline and in reply', commandText: '/task https://github.com/link-assistant/formal-ai', replyText: 'https://github.com/link-assistant/formal-ai\nIssue text here' },
];

for (const c of cases) {
  const resolved = resolveTaskIssueCreationInput({ commandText: c.commandText, replyText: c.replyText });
  const parsed = parseTaskIssueCreationInput(resolved);
  console.log(`\n[${c.name}]`);
  console.log('  resolved:', JSON.stringify(resolved));
  console.log('  parsed:', JSON.stringify(parsed));
}
