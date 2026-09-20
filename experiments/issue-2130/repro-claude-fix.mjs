#!/usr/bin/env node
// Issue #2130: candidate Hive Mind fix — deliver the prompt as an explicit
// `-p <prompt>` argument instead of relying on stdin being forwarded through
// `formal-ai with claude`.
import { spawn } from 'node:child_process';
const disallowed = ['AskUserQuestion', 'CronCreate', 'CronDelete', 'CronList', 'EnterPlanMode', 'EnterWorktree', 'ExitPlanMode', 'ExitWorktree', 'Monitor', 'NotebookEdit', 'PushNotification', 'RemoteTrigger', 'ScheduleWakeup', 'mcp__claude_ai_Gmail__*', 'mcp__claude_ai_Google_Drive__*', 'mcp__claude_ai_Google_Calendar__*'];
const args = ['with', 'claude', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--model', 'formal-ai', '--disallowedTools', ...disallowed, '-p', 'Say hello and stop.', '--append-system-prompt', 'You are an AI issue solver.'];
const child = spawn('formal-ai', args, { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', d => (out += d));
child.stderr.on('data', d => (out += d));
child.stdin.end();
child.on('exit', code => {
  console.log('EXIT:', code, '| stdin-lost:', /Input must be provided/.test(out));
  console.log(out.slice(0, 700));
});
