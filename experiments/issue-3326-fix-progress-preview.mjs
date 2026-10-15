#!/usr/bin/env node
// Issue #3326: preview the Telegram status texts `/fix` progress markers produce.
import { fixProgressLogLine, formatFixProgressMessage, parseFixProgressEvent } from '../src/fix-progress.lib.mjs';

const issueUrl = 'https://github.com/owner/repo/issues/3';
const sessionInfo = { executionUuid: 'a61345fd-cee9-4c6f-a240-a65224014fec', isolationBackend: 'docker', infoBlock: 'Requested by: @user' };
const events = [
  { phase: 'issue-created', issueUrl, branch: 'main' },
  {
    phase: 'waiting-for-ci',
    issueUrl,
    branch: 'main',
    pending: [
      { name: 'CI/CD Pipeline', status: 'in_progress' },
      { name: 'Release', status: 'queued' },
    ],
    waitedMs: 210000,
    timeoutMs: 3600000,
  },
  { phase: 'ci-finished', issueUrl, branch: 'main', outcome: 'finished', waitedMs: 630000 },
  { phase: 'solving', issueUrl, branch: 'main', ciOutcome: 'finished', waitedMs: 630000 },
];
for (const event of events) {
  const line = fixProgressLogLine(event);
  const parsed = parseFixProgressEvent(`noise\n${line}\nmore noise`);
  console.log(`--- ${event.phase} ---\n${line}\n\n${formatFixProgressMessage({ event: parsed, sessionName: '6bf7c2c7-4bee-4c8f-b239-c46af766a907', sessionInfo })}\n`);
}
