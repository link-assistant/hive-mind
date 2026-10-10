#!/usr/bin/env node
// Issue #2844: prints the docker-isolation summary lines hive-cleanup now produces
// for `fix <repo>` / `hive <repo>` sessions (previously only "session <uuid>").
import { buildSessionTaskRecords, formatDockerIsolationContainerSummary, planDockerIsolationCleanup } from '../src/cleanup.lib.mjs';

const fix = { uuid: '05b20a82-1111-4111-8111-111111111111', status: 'failed', exitCode: 1, isolation: 'docker', workingDirectory: '/home/box', command: "fix 'https://github.com/link-assistant/web-capture' --ci-cd" };
const hive = { uuid: '6c330d49-2222-4222-8222-222222222222', status: 'failed', exitCode: 1, isolation: 'docker', workingDirectory: '/home/box', command: "hive 'https://github.com/link-assistant/router' --all-issues" };
const fixLog = ['✅ Created issue: https://github.com/link-assistant/web-capture/issues/77', '✅ PR created:               #78', '📍 PR URL:                   https://github.com/link-assistant/web-capture/pull/78'].join('\n');

const plan = planDockerIsolationCleanup({
  containers: [fix, hive].map(s => ({ name: s.uuid, image: 'konard/hive-mind-dind', state: 'exited', status: 'Exited (1) 19 hours ago' })),
  sessionTasks: [...buildSessionTaskRecords(fix, { terminal: true, logText: fixLog }), ...buildSessionTaskRecords(hive, { terminal: true })],
  mode: 'succeeded',
});
console.log('🐳 Docker isolation containers (mode: succeeded):');
for (const item of [...plan.remove, ...plan.keep]) console.log(`   ${formatDockerIsolationContainerSummary(item)}`);
