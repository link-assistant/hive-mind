#!/usr/bin/env node
// Demonstrates usage-limit formatting without calling external APIs.

import { formatUsageLimitMessage } from '../src/usage-limit.lib.mjs';

const samples = [
  {
    tool: 'Claude',
    resetTime: '5:00 AM',
    sessionId: '64652bfd-65f5-460f-bb16-fa89fa8fc778',
    resumeCommand: 'node src/solve.mjs <issue-url> --resume 64652bfd-65f5-460f-bb16-fa89fa8fc778'
  },
  {
    tool: 'Codex',
    resetTime: '12:16 PM',
    sessionId: '019a77e4-0716-7152-8396-b642e26c3e20',
    resumeCommand: 'node src/solve.mjs <issue-url> --resume 019a77e4-0716-7152-8396-b642e26c3e20'
  },
  {
    tool: 'OpenCode',
    resetTime: null,
    sessionId: null,
    resumeCommand: null
  }
];

for (const s of samples) {
  console.log('---');
  console.log(formatUsageLimitMessage(s).join('\n'));
}

