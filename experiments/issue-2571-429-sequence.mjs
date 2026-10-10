// Issue #2571: reconstruct the Telegram request/429 sequence from a hive-telegram-bot log.
// Usage: node experiments/issue-2571-429-sequence.mjs path/to/hive-telegram-bot.log
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.argv[2];
if (!file) throw new Error('usage: node issue-2571-429-sequence.mjs <log>');
const rl = createInterface({ input: createReadStream(file) });
const events = [];
let lastTs = null;
let lineNo = 0;
for await (const line of rl) {
  lineNo++;
  const ts = line.match(/^(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d)/) || line.match(/\[(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d)/);
  if (ts) lastTs = ts[1];
  let m = line.match(/^\[VERBOSE\] Telegram Bot API (\w+) accepted; windows: (\{.*\})/);
  if (m) {
    const windows = JSON.parse(m[2]);
    if (windows.group !== undefined) events.push({ lineNo, lastTs, type: 'ok', method: m[1], group: windows.group });
    continue;
  }
  m = line.match(/Telegram Bot API rate limit: method=(\w+) chat=(\S+) retry_after=(\d+)s/);
  if (m) {
    events.push({ lineNo, lastTs, type: '429', method: m[1], chat: m[2], retryAfter: Number(m[3]) });
    continue;
  }
  m = line.match(/^\[telegram-send\] s\d+ editMessageText = unchanged/);
  if (m) events.push({ lineNo, lastTs, type: 'unchanged', method: 'editMessageText' });
}

const firstRateLimit = events.findIndex(e => e.type === '429');
console.log(`events with group windows: ${events.length}; first 429 at index ${firstRateLimit}`);
// Print compact sequence from 40 events before the first 429 to the end.
const tail = events.slice(Math.max(0, firstRateLimit - 40));
let out = '';
for (const e of tail) out += e.type === 'ok' ? `ok:${e.method === 'sendMessage' ? 'S' : 'E'}${e.group} ` : e.type === '429' ? `\n429:${e.method === 'sendMessage' ? 'S' : 'E'}(ra=${e.retryAfter},~${e.lastTs})\n` : 'u ';
console.log(out);
// Count accepted message requests that land between a 429 and the next 429 burst end.
let afterRefusal = 0;
for (let i = 0; i < events.length; i++) {
  if (events[i].type !== '429') continue;
  const next = events[i + 1];
  if (next && next.type === 'ok') afterRefusal++;
}
console.log(`\n429 immediately followed by an accepted group request: ${afterRefusal}`);
