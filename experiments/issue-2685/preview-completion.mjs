// Render the actual completion formatter for browser verification without sending Telegram messages.
import { writeFileSync } from 'node:fs';
import { formatSessionCompletionMessage } from '../../src/work-session-formatting.lib.mjs';
import { initI18n } from '../../src/i18n.lib.mjs';

await initI18n({ language: 'en' });

const sessionInfo = {
  command: 'hive',
  locale: 'en',
  startTime: new Date('2026-10-07T21:27:53.861Z'),
  executionUuid: '81b0b55c-8539-4f2b-b434-6db45306ec70',
  isolationBackend: 'docker',
  infoBlock: 'Command: `/hive`\nRepository: https://github.com/link-assistant/calculator\nOptions: `--tool codex --think xhigh`',
};
const message = formatSessionCompletionMessage({
  sessionName: '117b48f0-9780-4017-9f09-87eaf5e1afa9',
  sessionInfo,
  statusResult: { exitCode: 3, status: 'failed', endTime: '2026-10-07T21:28:42.126Z' },
});
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const html = escape(message)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
  .replaceAll('\n', '<br>');
const output = new URL('./completion-preview.html', import.meta.url);
writeFileSync(
  output,
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Hive completion formatter preview</title>
<style>body{margin:0;background:#eef3f7;font:18px/1.65 system-ui;color:#18242d;padding:36px}main{max-width:850px;margin:auto}p{color:#5b6870;font-size:15px}.message{padding:26px;border-radius:16px;background:white;box-shadow:0 2px 10px #2341;overflow-wrap:anywhere}strong{font-size:21px}code{font:15px ui-monospace,monospace;color:#355d73}</style>
<main><h1>Hive completion</h1><p>Browser preview of the production message formatter · no Telegram message sent</p><div class="message">${html}</div></main></html>\n`
);
console.log(output.pathname);
