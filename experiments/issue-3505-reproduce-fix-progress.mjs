// Issue #3505: replay the /fix progress markers of konard/voice-simulator#7
// through the real reporter (as the session monitor does) and validate every
// Telegram edit with the TDLib legacy-Markdown parser port.
//
// Usage: node experiments/issue-3505-reproduce-fix-progress.mjs
import { fixProgressLogLine, reportFixProgress } from '../src/fix-progress.lib.mjs';
import { formatSessionCompletionMessage, formatStartingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';
import { validateTelegramText } from '../src/telegram-markdown-validator.lib.mjs';

const infoBlock = 'Requested by: [@drakonard](https://t.me/drakonard)\nRepository: https://github.com/konard/voice-simulator\n\n🛠 Options: --ci-cd --think high\n\n🔒 Solve overrides: --attach-logs --verbose --no-tool-check --disable-report-issue --isolation docker';
const sessionName = '02d3489a-72e4-4d94-ab68-dc1164bcf041';
const issueUrl = 'https://github.com/konard/voice-simulator/issues/7';
const events = [
  { phase: 'issue-created', issueUrl, branch: 'main' },
  { phase: 'waiting-for-ci', issueUrl, branch: 'main', pending: [{ name: 'Checks and release', status: 'in_progress' }], waitedMs: 1000, timeoutMs: 3600000 },
  { phase: 'waiting-for-ci', issueUrl, branch: 'main', pending: [{ name: 'Checks and release', status: 'queued' }], waitedMs: 61000, timeoutMs: 3600000 },
  { phase: 'ci-finished', issueUrl, branch: 'main', outcome: 'finished', waitedMs: 63000, timeoutMs: 3600000 },
  { phase: 'solving', issueUrl, branch: 'main', ciOutcome: 'finished', waitedMs: 63000 },
];

const show = (label, message) => console.log(`--- ${label} ---\n${message}\n=> ${JSON.stringify(validateTelegramText(message, 'Markdown'))}\n`);
show('reply (before launch)', formatStartingWorkSessionMessage({ infoBlock }));

const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, infoBlock, executionUuid: 'c3e5e3bd-b103-4e3b-aa0b-d305033ae9e6', isolationBackend: 'docker', logPath: '/fake/log' };
const edits = [];
const bot = { telegram: { editMessageText: async (chatId, messageId, inline, message) => edits.push(message) } };
let log = '';
for (const event of events) {
  log += `${fixProgressLogLine(event)}\n`;
  const before = edits.length;
  await reportFixProgress({ bot, sessionName, sessionInfo, readTail: async () => log });
  if (edits.length === before) console.log(`--- ${event.phase} (no edit: same status) ---\n`);
  else show(`monitor edit for ${event.phase}`, edits.at(-1));
}
show('completion', formatSessionCompletionMessage({ sessionName, sessionInfo: { ...sessionInfo, startTime: new Date(Date.now() - 60000) }, exitCode: 0, infoBlock: sessionInfo.infoBlock }));
