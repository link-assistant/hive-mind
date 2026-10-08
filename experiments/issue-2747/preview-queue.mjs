// Render the actual /fix handler's response with deterministic incident metrics.
// No Telegram/GitHub calls, tool processes or isolation sessions are launched.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initI18n } from '../../src/i18n.lib.mjs';
import { SolveQueue } from '../../src/telegram-solve-queue.lib.mjs';
import { registerFixCommand } from '../../src/telegram-fix-command.lib.mjs';

await initI18n('en');
const queue = new SolveQueue({ autoStart: false });
for (let i = 1; i <= 8; i++) queue.enqueue({ tool: 'codex', url: `https://github.com/link-assistant/hive-mind/issues/${2737 + i}`, args: [] });
queue.canStartCommand = async () => ({ canStart: false, reason: 'CPU usage is 67% (threshold: 65%)\nCodex process is already running (3 processes)' });
const text = '/fix --update-all-dependencies --tool codex --think xhigh https://github.com/link-assistant/web-capture';
const replies = [];
let starts = 0;
const { handleFixCommand } = registerFixCommand(
  { command() {} },
  {
    VERBOSE: false,
    fixEnabled: true,
    addBreadcrumb: async () => {},
    isOldMessage: () => false,
    isGroupChat: () => true,
    isTopicAuthorized: () => true,
    isChatStopped: () => false,
    getSolveQueue: () => queue,
    resolveLocale: () => 'en',
    solveOverrides: ['--attach-logs', '--verbose', '--no-tool-check', '--disable-report-issue', '--isolation', 'docker'],
    safeReply: async (_ctx, reply) => {
      replies.push(reply);
      return { chat: { id: 1 }, message_id: 2 };
    },
    executeAndUpdateMessage: async () => {
      starts++;
    },
  }
);
await handleFixCommand({ chat: { id: 1 }, from: { id: 2, username: 'drakonard' }, message: { text, message_id: 3 } });
assert.equal(starts, 0);
assert.equal(queue.getStats().queuedByTool.codex, 9);
assert.equal(queue.getToolQueue('codex').at(-1).command, 'fix');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Issue 2747 queue verification</title><style>
body{margin:0;padding:36px;background:#17232d;color:#e9eef2;font:20px/1.5 system-ui;max-width:1020px}h1{font-size:26px}p{color:#a9bccb;font-size:17px}.message{margin:22px 0;padding:24px;border-radius:12px;background:#223544;white-space:pre-wrap;overflow-wrap:anywhere}.command{border-left:5px solid #53b596}.verified{padding:16px;border-radius:8px;background:#203d32;color:#93e4b3}</style>
<h1>/fix respects the Codex queue</h1><p>Deterministic handler preview • CPU 67%, threshold 65% • eight pending Codex requests</p>
<div class="message command">${escape(text)}</div><div class="message">${escape(replies[0])}</div>
<div class="verified">Verified: /fix is queued at position 9. Sessions started: ${starts}.</div>
<p>This preview renders the real handler response with mocked incident metrics; it is not a live Telegram session.</p></html>`;
await writeFile(fileURLToPath(new URL('./queue-preview.html', import.meta.url)), html);
console.log(replies[0]);
console.log(`sessionsStarted=${starts} codexPending=${queue.getStats().queuedByTool.codex}`);
