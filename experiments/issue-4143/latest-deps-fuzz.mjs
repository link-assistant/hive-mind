// Issue #4143, PR #4146 follow-up: re-check the latest links-notation and
// lino-objects-codec against the defects reported upstream, and fuzz the new
// APIs those releases added (`quoteReference`, `formatIndented({ nested: true })`).
//
// Run from a directory with the versions under test installed, for example:
//   mkdir /tmp/ln && cd /tmp/ln && npm i links-notation@0.32.0 lino-objects-codec@1.2.0
//   node /path/to/experiments/issue-4143/latest-deps-fuzz.mjs [seed] [runs]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const require = createRequire(pathToFileURL(`${process.cwd()}/`));
const ln = await import(pathToFileURL(require.resolve('links-notation')));
const codec = await import(pathToFileURL(require.resolve('lino-objects-codec')));
const { Parser, quoteReference } = ln;
const { formatIndented, parseIndented } = codec;
const parser = new Parser();
const pkg = name => JSON.parse(readFileSync(`${process.cwd()}/node_modules/${name}/package.json`, 'utf8')).version;
console.log(`links-notation ${pkg('links-notation')}, lino-objects-codec ${pkg('lino-objects-codec')}`);

const alphabet = ['a', 'Z', '0', '9', ' ', '"', "'", '`', '(', ')', ':', '\n', '\t', '-', '_', '.', '/', '\\', '~', '1', '{', '}', 'é', '😀', '#', '=', ',', '\r'];
let seed = Number(process.argv[2] || 1);
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const str = () => Array.from({ length: Math.floor(rnd() * 8) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
const runs = Number(process.argv[3] || 500);
const fixed = ['', '""', "''", '#x', '#', ':', 'a:b', '12:30', '~1{}', '~2{x}', '"\'`', '"""a', 'a b', '(x)', '1', 'true', 'null', ' lead', 'trail ', '\n', 'a\nb'];
const leafText = l => l.id;
const show = l => (l && typeof l === 'object' ? (l.values?.length ? [l.id, ...l.values.map(show)] : l.id) : l);

// 1. quoteReference: `root:` with `k <quoted>` must read back as the same string.
let qFail = 0;
const qSamples = [...fixed, ...Array.from({ length: runs }, str)];
for (const value of qSamples) {
  const text = `root:\n  k ${quoteReference(value)}\n  next 1\n`;
  let got;
  try {
    const [root] = parser.parse(text);
    got = root.values?.[0]?.values?.[1] ? leafText(root.values[0].values[1]) : JSON.stringify(show(root));
    if (root.values?.length !== 2) got = `values=${root.values?.length} ${JSON.stringify(show(root))}`;
  } catch (error) {
    got = `ERROR ${error.message.split('\n')[0]}`;
  }
  if (got !== value) {
    qFail++;
    if (qFail <= 8) console.log('quoteReference MISMATCH', JSON.stringify(value), '->', JSON.stringify(quoteReference(value)), 'read', JSON.stringify(got));
  }
}
console.log(`quoteReference: samples=${qSamples.length} failures=${qFail}`);

// 2. formatIndented({ nested: true }) with string-only trees.
const tree = depth => {
  const obj = {};
  const n = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    const key = str() || `k${i}`;
    if (depth < 3 && r < 0.3) obj[key] = tree(depth + 1);
    else if (r < 0.5) obj[key] = Array.from({ length: 1 + Math.floor(rnd() * 3) }, str);
    else obj[key] = str();
  }
  return obj;
};
const toParserTree = link => {
  const children = link.values || [];
  if (children.every(c => !c.values?.length)) return children.map(leafText);
  const result = {};
  for (const c of children) {
    if (c.id === null || c.id === undefined) result[leafText(c.values[0])] = leafText(c.values[1]);
    else result[c.id] = toParserTree(c);
  }
  return result;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let codecFail = 0;
let parserFail = 0;
let formatErrors = 0;
const trees = [{ a: '', b: '', c: ['--model', '', '#x'], d: { e: '12:30', f: '~1{}' } }, ...Array.from({ length: runs }, () => tree(0))];
for (const t of trees) {
  let text;
  try {
    text = formatIndented({ id: 'hive_mind_state', obj: t, nested: true });
  } catch (error) {
    formatErrors++;
    if (formatErrors <= 3) console.log('formatIndented ERROR', JSON.stringify(t), error.message);
    continue;
  }
  let back;
  try {
    back = parseIndented({ text, nested: true }).obj;
  } catch (error) {
    back = `ERROR ${error.message}`;
  }
  if (!same(back, t)) {
    codecFail++;
    if (codecFail <= 3) console.log('parseIndented MISMATCH\n', JSON.stringify(t), '\n', text, '\n', JSON.stringify(back));
  }
  let viaParser;
  try {
    viaParser = toParserTree(parser.parse(text)[0]);
  } catch (error) {
    viaParser = `ERROR ${error.message.split('\n')[0]}`;
  }
  if (!same(viaParser, t)) {
    parserFail++;
    if (parserFail <= 3) console.log('Parser MISMATCH\n', JSON.stringify(t), '\n', text, '\n', JSON.stringify(viaParser));
  }
}
console.log(`formatIndented nested: trees=${trees.length} formatErrors=${formatErrors} parseIndentedFailures=${codecFail} parserFailures=${parserFail}`);
