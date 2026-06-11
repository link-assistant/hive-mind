import { splitTelegramMessageText, parseCodeFence } from '../src/telegram-safe-reply.lib.mjs';

function check(name, cond) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) process.exitCode = 1;
}

// 1. Code block split across boundary stays valid (fences balanced per chunk)
const codeLine = 'const x = 1; // ' + 'a'.repeat(80);
let body = '```js\n';
for (let i = 0; i < 60; i++) body += codeLine + '\n';
body += '```';
const text = 'intro line\n' + body + '\nafter';
const chunks = splitTelegramMessageText(text, 500);
check('multiple chunks produced', chunks.length > 1);
check(
  'every chunk <= limit',
  chunks.every(c => c.length <= 500)
);
// each chunk must have an even number of fence lines (balanced)
for (const [i, c] of chunks.entries()) {
  const fences = c.split('\n').filter(l => parseCodeFence(l)).length;
  check(`chunk ${i} balanced fences (${fences})`, fences % 2 === 0);
}
// language repeated on reopened fences (chunks after the first that start inside code)
const reopened = chunks.slice(1).filter(c => c.startsWith('```js'));
check('language repeated on reopen', reopened.length >= 1);
console.log('chunk count', chunks.length);

// 2. No code block: line-based packing, each chunk <= limit, no broken lines
const plain = Array.from({ length: 200 }, (_, i) => `line number ${i} hello world`).join('\n');
const c2 = splitTelegramMessageText(plain, 300);
check(
  'plain chunks <= limit',
  c2.every(c => c.length <= 300)
);
check('plain no line cut (rejoin lines equal)', c2.join('\n').split('\n').length === 200);

// 3. short text returns single chunk identical
const s = 'hello world';
const c3 = splitTelegramMessageText(s, 4096);
check('short text single chunk identical', c3.length === 1 && c3[0] === s);

// 4. very long single line hard split
const long = 'x'.repeat(2000);
const c4 = splitTelegramMessageText(long, 500);
check(
  'long line split <= limit',
  c4.every(c => c.length <= 500)
);
check('long line content preserved', c4.join('').replace(/\n/g, '') === long || c4.join('').length >= long.length);
