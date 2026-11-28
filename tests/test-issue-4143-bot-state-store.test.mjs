#!/usr/bin/env node
/**
 * Issue #4143: durable bot state — LiNo codec, link-cli doublets codec, the
 * dual store (.lino first, link-cli second, reads compare both) and the
 * PID-owned state lock.
 *
 * Uses a real `clink` (link-cli) when one is on PATH or in HIVE_MIND_CLINK;
 * otherwise those checks are skipped and the store runs .lino-only.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assert, asyncTest, printSummary, getFailCount, skip } from './test-helpers.mjs';
import { formatLinoTree, formatVerifiedLinoTree, normalizeStringTree, parseLinoTree, quoteLinoScalar, stringTreesEqual } from '../src/bot-state-lino.lib.mjs';
import { MAX_LINE_DEPTH, createLinksStore, decodeDoublets, encodeDoublets, resolveClinkCommand, toLinkName } from '../src/bot-state-links.lib.mjs';
import { createBotStateStore, stateToStringTree, stringTreeToState } from '../src/bot-state-store.lib.mjs';
import { currentLockOwner, isLockOwnerDead, resolveStateLockMode, withStateLock } from '../src/state-lock.lib.mjs';

// Trees compare after normalization: empty objects and arrays are not stored.
const same = (a, b) => stringTreesEqual(normalizeStringTree(a) ?? {}, normalizeStringTree(b) ?? {});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hm-4143-'));
const TRICKY = ['', ' ', '#not a comment', 'a:b', '"', "'", '`', '""', "''", '"""x', '(x)', 'line1\nline2', 'tab\there', 'cr\rlf', '~b64_abc', 'Привет мир', 'emoji 🚀', '123', '-1', 'hive_mind_state', 'https://github.com/o/r/issues/1#issuecomment-2', '--flag=value "q"'];

const sampleTree = () => ({
  version: '1',
  intake: { state: 'draining', reason: 'deploy: v2 "now"' },
  tasks: { 'q-1': { url: 'https://github.com/o/r/issues/1', args: ['--model', 'opus', '', '#x'], status: 'queued' } },
  tricky: Object.fromEntries(TRICKY.map((value, index) => [`k${index}`, value])),
  keys: Object.fromEntries(TRICKY.filter(Boolean).map(value => [value, 'v'])),
  empty: {},
  list: [],
});

const clinkCommand = resolveClinkCommand();
let clinkAvailable = false;
try {
  execFileSync(clinkCommand, ['--version'], { stdio: 'ignore' });
  clinkAvailable = true;
} catch {
  clinkAvailable = false;
}

console.log('🧪 Issue #4143: bot state store\n');

await asyncTest('LiNo: tricky scalars survive format + parse', async () => {
  const tree = sampleTree();
  const text = await formatVerifiedLinoTree(tree);
  const { rootKey, tree: parsed } = await parseLinoTree(text);
  assert(rootKey === 'hive_mind_state', 'root key is hive_mind_state');
  assert(same(parsed, tree), 'parsed tree equals the input');
  assert(!/^\s*\(/m.test(text.split('\n').slice(1).join('\n')), 'nested values are indented, not parenthesized');
});

await asyncTest('LiNo: quoting picks the cheapest safe form', async () => {
  assert(quoteLinoScalar('plain') === 'plain', 'plain word is raw');
  assert(quoteLinoScalar('a b') === '"a b"', 'spaces are double quoted');
  assert(quoteLinoScalar('say "hi"') === '\'say "hi"\'', 'double quotes switch to single quotes');
  assert(quoteLinoScalar('').startsWith('~b64_'), 'empty string is base64 (links-notation pairs "" across lines)');
  assert(quoteLinoScalar('#x') !== '#x', 'leading # is quoted (links-notation comment)');
  assert(formatLinoTree({ a: { b: 'c' } }).includes('\n    b c'), 'nested object is indented');
});

// Build a fake export: assign ids to every sub-link, as clink --out would print.
const fakeExport = document => {
  const defined = new Set(
    document
      .trim()
      .split('\n')
      .map(line => /^\(([^:\s]+):/.exec(line)[1])
  );
  const ids = new Map();
  const lines = [];
  const point = name => {
    if (!ids.has(name) && !defined.has(name)) {
      ids.set(name, name);
      lines.push(`(${name}: ${name} ${name})`);
    }
    return name;
  };
  let counter = 0;
  const parse = (text, at = 0) => {
    if (text[at] !== '(') {
      const end = text.slice(at).search(/[\s)]/);
      const name = text.slice(at, end < 0 ? text.length : at + end);
      return [point(name), at + name.length];
    }
    const [left, next] = parse(text, at + 1);
    const [right, after] = parse(text, next + 1);
    const key = `${left} ${right}`;
    if (!ids.has(key)) {
      const id = String(++counter);
      ids.set(key, id);
      lines.push(`(${id}: ${left} ${right})`);
    }
    return [ids.get(key), after + 1];
  };
  for (const line of document.trim().split('\n')) {
    const [, name, body] = /^\(([^:\s]+): (.*)\)$/.exec(line);
    const [left, next] = parse(body);
    const [right] = parse(body, next + 1);
    lines.push(`(${name}: ${left} ${right})`);
  }
  return lines.join('\n');
};
const maxLineDepth = document =>
  Math.max(
    ...document
      .trim()
      .split('\n')
      .map(line => {
        let depth = 0;
        let max = 0;
        for (const char of line) max = Math.max(max, (depth += char === '(' ? 1 : char === ')' ? -1 : 0));
        return max;
      })
  );

await asyncTest('doublets: encode/decode round trip and safe names', async () => {
  const tree = sampleTree();
  const document = encodeDoublets(tree);
  assert(document.startsWith('(hive_mind_state: hive_mind_state (~obj '), 'root link points at an object');
  assert(toLinkName('hive_mind_state').startsWith('~b64_'), 'root name inside values is encoded');
  assert(toLinkName('123').startsWith('~b64_'), 'numeric names are encoded (link-cli treats them as ids)');
  assert(same(decodeDoublets(fakeExport(document)), tree), 'decoded tree equals the input');
  assert(decodeDoublets('(1: 1 1)') === null, 'no root link decodes to null');
});

await asyncTest('doublets: long lists stay under the link-cli nesting limit of 64', async () => {
  const tree = { tasks: Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`task-${index}`, { url: `u${index}`, args: Array.from({ length: 80 }, (_, item) => `a${item}`) }])) };
  const document = encodeDoublets(tree);
  assert(maxLineDepth(document) <= MAX_LINE_DEPTH + 1, `every line nests at most ${MAX_LINE_DEPTH + 1} levels (got ${maxLineDepth(document)})`);
  assert(document.trim().split('\n').at(-1).startsWith('(hive_mind_state: hive_mind_state '), 'the root link comes last');
  assert(same(decodeDoublets(fakeExport(document)), tree), 'decoded tree equals the input');
  assert(encodeDoublets(tree) === document, 'the encoding is deterministic');
});

await asyncTest('link-cli store: disabled and missing binaries degrade to .lino only', async () => {
  assert(resolveClinkCommand({ HIVE_MIND_CLINK: 'off' }) === null, 'HIVE_MIND_CLINK=off disables link-cli');
  const missing = createLinksStore({ dbPath: path.join(tmp(), 's.links'), command: 'clink-does-not-exist-4143' });
  assert((await missing.available()) === false, 'missing binary is unavailable');
  assert((await missing.write({ a: 'b' })) === false, 'write is skipped');
  assert((await missing.read()) === null, 'read returns null');
});

await asyncTest('link-cli store: real clink round trip with transactions', async () => {
  if (!clinkAvailable) return skip('clink is not installed');
  const dir = tmp();
  const store = createLinksStore({ dbPath: path.join(dir, 's.links'), logMaxBytes: 4096 });
  for (let index = 0; index < 4; index++) {
    const tree = { ...sampleTree(), counter: String(index) };
    await store.write(tree);
    assert(same(await store.read(), tree), `write ${index + 1} reads back`);
  }
  assert(
    fs.readdirSync(dir).some(name => name.includes('transitions')),
    'transactions log files exist'
  );
});

const fakeLinks = (initial = null) => {
  let tree = initial;
  const calls = { read: 0, write: 0 };
  return {
    calls,
    set: value => (tree = value),
    dbPath: '/fake/hive-mind-state.links',
    available: async () => true,
    read: async () => {
      calls.read++;
      return tree && JSON.parse(JSON.stringify(tree));
    },
    write: async value => {
      calls.write++;
      tree = JSON.parse(JSON.stringify(value));
      return true;
    },
  };
};

await asyncTest('dual store: writes .lino then link-cli and reads agree', async () => {
  const links = fakeLinks();
  const store = createBotStateStore({ dir: tmp(), linksStore: links, log: () => {} });
  const empty = await store.read();
  assert(empty.exists === false && empty.source === 'empty' && empty.state.intake.state === 'accepting', 'empty state has defaults');
  const updated = await store.update(state => {
    state.tasks.a = { url: 'u', chatId: -100123, showLimits: true, args: ['x'] };
    state.subscribers['42'] = { userId: 42, username: 'n' };
  });
  assert(updated.written && updated.binaryWritten, 'both stores written');
  assert(fs.readFileSync(store.paths.lino, 'utf8').startsWith('hive_mind_state'), '.lino file exists with the root');
  const read = await store.read();
  assert(read.consistent === true && read.source === 'links' && read.attempts === 1, 'read from link-cli when the stores agree');
  assert(read.state.tasks.a.chatId === -100123 && read.state.tasks.a.showLimits === true, 'numbers and booleans are decoded');
  assert(read.state.subscribers['42'].userId === 42, 'subscribers are kept');
  const peeked = await store.peek();
  assert(peeked.tasks.a.url === 'u', 'peek reads the .lino copy');
});

await asyncTest('dual store: mismatch retries, falls back to .lino, next write repairs', async () => {
  const links = fakeLinks();
  const logs = [];
  const store = createBotStateStore({ dir: tmp(), linksStore: links, retryDelayMs: 1, log: message => logs.push(message) });
  await store.update(state => {
    state.intake = { state: 'draining', requestedAt: '2026-01-01T00:00:00.000Z' };
  });
  links.set({ version: '1', intake: { state: 'accepting' } });
  const read = await store.read();
  assert(read.consistent === false && read.source === 'lino', 'falls back to .lino');
  assert(read.attempts === 5, 'retried 3 times lock-free and once under the lock');
  assert(read.state.intake.state === 'draining', '.lino content wins');
  assert(
    logs.some(message => message.includes('differ')),
    'mismatch is logged'
  );
  const repaired = await store.update(() => false);
  assert(repaired.written === true, 'update writes even without changes when the stores disagreed');
  assert((await store.read()).consistent === true, 'stores agree again');
});

await asyncTest('state tree conversion drops undefined and keeps arrays', async () => {
  const tree = stateToStringTree({ a: undefined, b: null, c: [1, 'x'], d: new Date(0), e: { pid: 5 } });
  assert(!('a' in tree) && !('b' in tree), 'undefined and null are dropped');
  assert(tree.c[0] === '1' && tree.d === '1970-01-01T00:00:00.000Z', 'values become strings');
  assert(stringTreeToState(tree).e.pid === 5, 'pid decodes to a number');
});

await asyncTest('PID lock: a dead owner is broken at once, mode none skips locking', async () => {
  const dir = tmp();
  const lockPath = path.join(dir, 'x.lock');
  const self = currentLockOwner();
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ ...self, pid: 999999 }));
  const started = Date.now();
  const result = await withStateLock('x', async () => 'ran', { lockPath, mode: 'pid', isAlive: () => false, timeoutMs: 5000 });
  assert(result === 'ran' && Date.now() - started < 2000, 'lock of a dead PID is released without waiting for staleness');
  assert(!fs.existsSync(lockPath), 'lock removed after the critical section');
  assert(isLockOwnerDead({ ...self, pid: 999999, hostname: 'other-host' }, { self, isAlive: () => false }) === false, 'owners on other hosts are never presumed dead');
  fs.mkdirSync(lockPath);
  assert((await withStateLock('x', async () => 'free', { lockPath, mode: 'none' })) === 'free', 'mode none ignores the lock');
  assert(resolveStateLockMode(undefined, { HIVE_MIND_STATE_LOCK_MODE: 'age' }) === 'age', 'mode comes from HIVE_MIND_STATE_LOCK_MODE');
});

await asyncTest('PID lock: verbose trace names the live holder once, then times out', async () => {
  const lockPath = path.join(tmp(), 'x.lock');
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ ...currentLockOwner(), pid: 4242 }));
  const traces = [];
  let error = null;
  await withStateLock('x', async () => 'never', { lockPath, mode: 'pid', isAlive: () => true, timeoutMs: 30, pollMs: 5, trace: message => traces.push(message) }).catch(caught => (error = caught));
  assert(error && /Timed out/.test(error.message), 'a live holder makes the waiter time out');
  assert(traces.length === 1 && traces[0].includes('held by pid 4242'), 'the holder is traced once');
});

await asyncTest('link-cli store: every clink call is timed in the trace', async () => {
  const dir = tmp();
  const logs = [];
  const calls = [];
  const run = async (command, args) => {
    calls.push(args);
    const db = args[args.indexOf('--db') + 1];
    if (args.includes('--in')) fs.writeFileSync(db, 'x');
    if (args.includes('--out')) fs.writeFileSync(args[args.indexOf('--out') + 1], '');
  };
  const store = createLinksStore({ dbPath: path.join(dir, 's.links'), command: 'clink-fake', run, log: message => logs.push(message) });
  await store.write({ a: 'b' });
  await store.write({ a: 'c' });
  assert(
    logs.some(message => /^clink --in .*s\.links: \d+ms$/.test(message)),
    '--in is timed'
  );
  assert(
    logs.some(message => /^clink --out .*s\.links: \d+ms$/.test(message)),
    '--out is timed'
  );
  // link-cli#199: a full import with --transactions commits once per link.
  const imports = calls.filter(args => args.includes('--in'));
  assert(imports.length === 2, 'one import per write');
  assert(!imports[0].includes('--transactions') && /\.fresh\.links$/.test(imports[0][imports[0].indexOf('--db') + 1]), 'the first write builds a fresh store without --transactions');
  assert(imports[1].includes('--transactions') && imports[1][imports[1].indexOf('--db') + 1] === store.dbPath, 'later writes import into the store with --transactions');
  assert(
    fs.readdirSync(dir).every(name => !name.includes('.fresh.')),
    'the fresh store is renamed into place'
  );
  // link-cli#110: names are looked up by scanning the names store without it.
  assert(
    calls.filter(args => args.includes('--in') || args.includes('--out')).every(args => args.includes('--indexed-lookups')),
    'every import and export uses --indexed-lookups'
  );
  const plainCalls = [];
  const plain = createLinksStore({ dbPath: path.join(tmp(), 's.links'), command: 'clink-fake', indexedLookups: false, run: async (command, args) => run(command, args).then(() => plainCalls.push(args)) });
  await plain.write({ a: 'b' });
  assert(plainCalls.length > 1 && plainCalls.every(args => !args.includes('--indexed-lookups')), 'indexedLookups: false leaves the flag out');
});

await asyncTest('link-cli store: real clink stores a state with many tasks', async () => {
  if (!clinkAvailable) return skip('clink is not installed');
  const store = createLinksStore({ dbPath: path.join(tmp(), 's.links') });
  const tree = { tasks: Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`task-${index}`, { url: `https://github.com/o/r/issues/${index}`, args: ['--model', 'opus'] }])) };
  await store.write(tree);
  assert(same(await store.read(), tree), '120 tasks read back (a one-line import nested past 64 levels)');
  tree.tasks['task-7'].url = 'changed';
  await store.write(tree);
  assert(same(await store.read(), tree), 'an incremental write of the large state reads back');
});

await asyncTest('link-cli store: real clink rebuild replaces the store atomically', async () => {
  if (!clinkAvailable) return skip('clink is not installed');
  const dir = tmp();
  const logs = [];
  const store = createLinksStore({ dbPath: path.join(dir, 's.links'), log: message => logs.push(message) });
  let tree;
  for (let index = 0; index < 12 && !logs.some(message => message.startsWith('Rebuilding')); index++) {
    tree = { ...sampleTree(), counter: String(index), [`k${index}`]: Array.from({ length: 12 }, (_, item) => `v${index}-${item}`) };
    await store.write(tree);
  }
  assert(
    logs.some(message => message.startsWith('Rebuilding')),
    'garbage triggers a rebuild'
  );
  assert(same(await store.read(), tree), 'the rebuilt store reads back the last tree');
  assert(
    fs.readdirSync(dir).every(name => !name.includes('.fresh.')),
    'no fresh store files are left behind'
  );
  await store.write({ ...tree, counter: 'after' });
  assert((await store.read()).counter === 'after', 'transactional writes work on the rebuilt store');
});

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
