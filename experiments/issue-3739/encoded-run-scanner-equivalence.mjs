// The linear run scanners in src/encoded-credential-detection.lib.mjs must
// return exactly what the regular expressions they replaced returned. This
// compares both on random short strings over an alphabet chosen to hit every
// boundary (deterministic seed, finite iterations).
// Usage: node experiments/issue-3739/encoded-run-scanner-equivalence.mjs [iterations]
import { __runScannersForTests as scanners } from '../../src/encoded-credential-detection.lib.mjs';

const reference = {
  base64: String.raw`[A-Za-z0-9+/_-]{24,}={0,2}`,
  hex: String.raw`\b[0-9a-fA-F]{32,}\b`,
  percent: String.raw`%[0-9a-fA-F]{2}(?:%[0-9a-fA-F]{2}|[A-Za-z0-9._~!*'()-])*`,
  escape: String.raw`(?:\\u00[0-9a-fA-F]{2}|\\x[0-9a-fA-F]{2}){8,}`,
  entity: String.raw`(?:&#x?[0-9a-fA-F]{1,5};){8,}`,
};
const matchAll = (source, text) => [...text.matchAll(new RegExp(source, 'g'))].map(match => ({ run: match[0], index: match.index }));
const wrappedReference = text =>
  [...text.matchAll(/(\r?\n)([ \t]*)([A-Za-z0-9+/_-]{16,}={0,2})[ \t]*(?=\r?\n|$)/g)].map(match => {
    const start = match.index + match[1].length + match[2].length;
    return { index: match.index, start, end: start + match[3].length, lastIndex: match.index + match[0].length };
  });
const tailReference = (text, from) => /^[ \t]*\r?\n[ \t]*[A-Za-z0-9+/_-]{1,15}={0,2}(?=[ \t]*(?:\r?\n|$))/.exec(text.slice(from))?.[0].length ?? 0;

let seed = 3739;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pieces = ['a', 'F', '0', '9', 'g', 'Z', '+', '/', '_', '-', '=', '==', '%', '%4', '%41', '%2F', '\\x41', '\\u0041', '\\x4', '&#65;', '&#x41;', '&#;', '.', '~', '!', ' ', '\t', '\n', '\r\n', '\r', 'é', '—', 'abcdef0123456789', 'QUJDREVGR0hJSktMTU5PUA', '\\x41\\x42\\u0043\\x44', '&#65;&#x42;&#67;&#68;'];
const sample = () => Array.from({ length: Math.floor(random() * 40) }, () => pieces[Math.floor(random() * pieces.length)]).join('');

const iterations = Number(process.argv[2] || 20000);
let failures = 0;
const matched = {};
const check = (name, text, expected, actual) => {
  if (Array.isArray(expected) ? expected.length : expected) matched[name] = (matched[name] || 0) + 1;
  if (JSON.stringify(expected) === JSON.stringify(actual)) return;
  failures++;
  if (failures <= 10) console.log(JSON.stringify({ name, text, expected, actual }));
};
for (let iteration = 0; iteration < iterations; iteration++) {
  const text = sample();
  for (const [name, source] of Object.entries(reference)) check(name, text, matchAll(source, text), scanners[name](text));
  check('wrapped-line', text, wrappedReference(text), scanners.wrappedLines(text));
  for (let from = 0; from <= text.length; from++) check('wrapped-tail', `${text}@${from}`, tailReference(text, from), scanners.wrappedTail(text, from));
}
console.log(JSON.stringify({ iterations, failures, matched }));
process.exitCode = failures ? 1 : 0;
