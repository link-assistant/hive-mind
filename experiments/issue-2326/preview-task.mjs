// Print Telegram /task URL rejection replies; no Telegram API calls.
import { formatTaskUrlError } from '../../src/telegram-task-command.lib.mjs';
import { parseTaskIssueUrl } from '../../src/task.split.lib.mjs';

for (const url of process.argv.length > 2 ? process.argv.slice(2) : ['https://github.com/o/r/issuese/1', 'https://github.com/o/r/pull/1', 'https://github.com/o/r']) {
  console.log(`${formatTaskUrlError(parseTaskIssueUrl(url), url)}\n---`);
}
