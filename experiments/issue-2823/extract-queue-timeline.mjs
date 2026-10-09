#!/usr/bin/env node
/**
 * Issue #2823: extract a /queue timeline from hive-telegram-bot.log.
 *
 * Usage: node experiments/issue-2823/extract-queue-timeline.mjs /path/to/hive-telegram-bot.log
 *
 * Prints, for every `/queue` reply, the closest preceding log timestamp, the
 * message size, whether it was a continuation chunk (no "Solve Queue Status"
 * title), the summary line, and the URLs that were listed both as Processing
 * (▶️) and Completed (✅) in the same reply. Also lists failed
 * `session_completed` events, which the old summary never counted.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const path = process.argv[2];
if (!path) {
  console.error('usage: extract-queue-timeline.mjs <hive-telegram-bot.log>');
  process.exit(2);
}

const TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;
const SEND_RE = /^\[telegram-send\] s\d+ sendMessage → .* chars=(\d+) .* text="(.*)"$/;
let lastTs = '?';
const replies = [];
const failures = [];
let pendingContinuation = false;

const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
for await (const line of rl) {
  const ts = line.match(TS_RE);
  if (ts) lastTs = ts[1];
  if (line.includes('EVENT session_completed') && line.includes('"failed"')) {
    failures.push(`${lastTs}Z ${line.match(/"sessionName":"([^"]+)"/)?.[1]} exit=${line.match(/"exitCode":(-?\d+|null)/)?.[1]}`);
  }
  const send = line.match(SEND_RE);
  if (!send) continue;
  const text = send[2].replace(/\\n/g, '\n');
  const isTitle = text.includes('Solve Queue Status');
  const isContinuation = !isTitle && pendingContinuation && /^ {2,}[•✅]/.test(text);
  if (!isTitle && !isContinuation) continue;
  // A long status ends without the summary line; its tail arrives next.
  pendingContinuation = isTitle && !/Completed: \d+, Failed: \d+/.test(text);
  const processing = new Set([...text.matchAll(/• \[[^\]]+\]\(([^)]+)\) \(▶️/g)].map(m => m[1]));
  const completed = new Set([...text.matchAll(/✅ \[[^\]]+\]\(([^)]+)\)/g)].map(m => m[1]));
  const both = [...processing].filter(url => completed.has(url));
  replies.push({ ts: lastTs, chars: Number(send[1]), continuation: isContinuation, summary: text.match(/Completed: \d+, Failed: \d+/)?.[0] || '-', both });
}

console.log(`# /queue replies (${replies.length})`);
for (const r of replies) {
  console.log(`${r.ts}Z chars=${r.chars}${r.continuation ? ' CONTINUATION(no headers)' : ''} summary="${r.summary}"${r.both.length ? ` processing∩completed=${r.both.length}` : ''}`);
}
console.log(`\n# failed session_completed events (${failures.length})`);
for (const f of failures) console.log(f);
