#!/usr/bin/env node

/**
 * Measure duplicated token-usage records in a Claude Code session transcript (issue #2160, P8).
 *
 * Hive Mind deduplicates transcript entries by `message.id` before summing tokens
 * (src/claude.lib.mjs) and reports how many it skipped. The reported hive run 4c1dedd8 skipped
 * 13-86 duplicates in each of 10 sessions, which is the recurrence evidence for
 * anthropics/claude-code#6805 ("Token Usage Statistics Duplicated in stream-json Mode"). Since #6805
 * was closed as inactive and locked, the recurrence was re-filed with these measurements as
 * anthropics/claude-code#87303.
 *
 * This script shows, for any transcript, (a) how much a naive sum over-counts and (b) *why*:
 * one API response whose content has several blocks (text + tool_use + ...) is written as several
 * assistant entries, each repeating the full `usage` object.
 *
 * Usage:
 *   node experiments/issue-2160-claude-jsonl-usage-duplication.mjs <session.jsonl> [...]
 *   node experiments/issue-2160-claude-jsonl-usage-duplication.mjs ~/.claude/projects/*<project>*<slash>*.jsonl
 */

import { readFileSync } from 'node:fs';

const USAGE_FIELDS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];

const analyze = file => {
  const byId = new Map();
  let records = 0;
  const naive = Object.fromEntries(USAGE_FIELDS.map(field => [field, 0]));
  const deduplicated = Object.fromEntries(USAGE_FIELDS.map(field => [field, 0]));

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (!message?.usage || !message?.model || !message.id) continue;
    records += 1;
    for (const field of USAGE_FIELDS) naive[field] += message.usage[field] || 0;
    if (!byId.has(message.id)) {
      byId.set(message.id, []);
      for (const field of USAGE_FIELDS) deduplicated[field] += message.usage[field] || 0;
    }
    byId.get(message.id).push({
      contentTypes: Array.isArray(message.content) ? message.content.map(block => block.type) : [typeof message.content],
      usage: JSON.stringify(message.usage),
    });
  }

  const duplicatedIds = [...byId.entries()].filter(([, entries]) => entries.length > 1);
  return {
    file,
    records,
    distinctMessageIds: byId.size,
    duplicatedRecords: records - byId.size,
    idsWithDuplicates: duplicatedIds.length,
    idsWhoseDuplicatesAreIdentical: duplicatedIds.filter(([, entries]) => entries.every(candidate => candidate.usage === entries[0].usage)).length,
    maxEntriesPerMessageId: byId.size ? Math.max(...[...byId.values()].map(entries => entries.length)) : 0,
    contentBlockShapes: [...new Set(duplicatedIds.map(([, entries]) => entries.map(candidate => candidate.contentTypes.join('+')).join(' | ')))].slice(0, 5),
    naive,
    deduplicated,
    inflation: Object.fromEntries(USAGE_FIELDS.map(field => [field, deduplicated[field] ? `${(naive[field] / deduplicated[field]).toFixed(2)}x` : 'n/a'])),
  };
};

const files = process.argv.slice(2);
if (!files.length) {
  process.stderr.write('usage: node experiments/issue-2160-claude-jsonl-usage-duplication.mjs <session.jsonl> [...]\n');
  process.exit(2);
}
process.stdout.write(`${JSON.stringify(files.map(analyze), null, 2)}\n`);
