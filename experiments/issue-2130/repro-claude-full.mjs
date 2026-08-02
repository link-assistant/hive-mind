#!/usr/bin/env node
// Issue #2130: reproduce the exact argument list Hive Mind executes for
// `--tool claude --model formal-ai` (src/claude.lib.mjs, non-resume path).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const mcpConfig = '/tmp/claude-mcp-no-useless-repro-2130.json';
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: {} }));

const disallowed = ['AskUserQuestion', 'CronCreate', 'CronDelete', 'CronList', 'EnterPlanMode', 'EnterWorktree', 'ExitPlanMode', 'ExitWorktree', 'Monitor', 'NotebookEdit', 'PushNotification', 'RemoteTrigger', 'ScheduleWakeup', 'mcp__claude_ai_Gmail__*', 'mcp__claude_ai_Google_Drive__*', 'mcp__claude_ai_Google_Calendar__*'];
const withMcp = process.argv.includes('--no-mcp') ? [] : ['--strict-mcp-config', '--mcp-config', mcpConfig];
const withDisallowed = process.argv.includes('--no-disallowed') ? [] : ['--disallowedTools', ...disallowed];
const withSystem = process.argv.includes('--no-system') ? [] : ['--append-system-prompt', 'You are an AI issue solver. Follow the repository guidelines.'];

const args = ['with', 'claude', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--model', 'formal-ai', ...withMcp, ...withDisallowed, ...withSystem];
console.log('ARGS:', args.join(' '));
const child = spawn('formal-ai', args, { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', d => (out += d));
child.stderr.on('data', d => (out += d));
child.stdin.end('Say hello and stop.');
child.on('exit', code => {
  console.log('EXIT:', code);
  console.log(out.slice(0, 900));
});
