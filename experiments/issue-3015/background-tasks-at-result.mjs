#!/usr/bin/env node
/**
 * Issue #3015: which Claude Code background tasks were still running when the solver's
 * post-result close timeout stopped the CLI?
 *
 * Replays the stream-json events of a solve log (with or without the `[timestamp] [INFO]`
 * prefix) through the same tracker the solver now uses, and prints the running tasks at the
 * first `result` event and at the "Stream timeout — sending SIGTERM" line.
 *
 * Usage: node experiments/issue-3015/background-tasks-at-result.mjs <solve.log> [...more logs]
 */
import { readFile } from 'node:fs/promises';
import { createClaudeBackgroundTaskTracker, describeBackgroundTasks } from '../../src/claude.result-close.lib.mjs';

const PREFIX = /^\[[^\]]+\] \[[A-Z]+\] ?/;

const scan = async file => {
  const lines = (await readFile(file, 'utf8')).split('\n').map(line => line.replace(PREFIX, ''));
  const tracker = createClaudeBackgroundTaskTracker();
  const report = [];
  let buffer = null;
  let resultSeen = false;
  for (const [index, line] of lines.entries()) {
    if (buffer === null && line === '{') {
      buffer = [line];
      continue;
    }
    if (buffer !== null) {
      buffer.push(line);
      if (line !== '}') continue;
      let event = null;
      try {
        event = JSON.parse(buffer.join('\n'));
      } catch {
        // not a stream event
      }
      buffer = null;
      if (!event) continue;
      tracker.observeEvent(event);
      if (event.type === 'result' && !resultSeen) {
        resultSeen = true;
        report.push(`line ${index + 1}: result subtype=${event.subtype} is_error=${event.is_error === true}; running background tasks: ${describeBackgroundTasks(tracker.running()) || 'none'}`);
      }
      if (event.subtype === 'task_notification' && resultSeen) report.push(`line ${index + 1}: task_notification ${event.task_id} ${event.status} (${event.summary || ''})`);
      continue;
    }
    if (line.includes('Stream timeout — sending SIGTERM')) report.push(`line ${index + 1}: solver SIGTERM; running background tasks: ${describeBackgroundTasks(tracker.running()) || 'none'}`);
  }
  return report;
};

for (const file of process.argv.slice(2)) {
  console.log(`== ${file}`);
  for (const line of await scan(file)) console.log(`   ${line}`);
}
