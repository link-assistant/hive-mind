// Lists the bot import closure (src/telegram-bot.mjs) for the issue #3614 polling audit.
import { computeImportClosure } from '../eslint-rules/bot-import-closure.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const files = computeImportClosure(`${root}src/telegram-bot.mjs`, { rootDir: root });
for (const f of files) console.log(f);
