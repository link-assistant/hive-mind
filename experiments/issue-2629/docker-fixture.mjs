#!/usr/bin/env node
/** Finite Docker CLI fixture; never contacts a real daemon. */
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const uuid = 'e6c1dd3f-3acd-475d-8df4-f45b75879a8b';
const resume = `${uuid}-resume-1`;
const id = 'a'.repeat(64);
const imageId = `sha256:${'b'.repeat(64)}`;
const image = `start-command-resume/${uuid}:1`;
const scenario = process.env.CLEANUP_DOCKER_SCENARIO;
if (process.env.CLEANUP_DOCKER_CALLS) appendFileSync(process.env.CLEANUP_DOCKER_CALLS, JSON.stringify(args) + '\n');
if (scenario === 'discovery-failure' && args[0] === 'ps') {
  console.error('snapshotter.Usage failed: snapshot not found');
  process.exit(1);
}
if (args[0] === 'ps') {
  if (args.includes('--filter')) console.log(scenario === 'restart-race' ? id : '');
  else console.log(`${id}\t${resume}\texited\tExited (${scenario === 'success' ? 0 : 127}) 3 days ago\t${image}\t2026-10-04 18:00:00 +0000 UTC`);
} else if (args[0] === 'inspect') {
  const format = args[args.indexOf('--format') + 1];
  if (args.includes('--size')) console.log(15000000000);
  else if (format === '{{json .State}}') console.log(JSON.stringify({ Running: false, Restarting: false, Pid: 0, Status: 'exited', ExitCode: scenario === 'success' ? 0 : 127, FinishedAt: '2026-10-04T18:00:00Z' }));
  else console.log(`false false 0 exited ${scenario === 'success' ? 0 : 127} 2026-10-04T18:00:00Z`);
} else if (args[0] === 'image' && args[1] === 'ls') {
  console.log(JSON.stringify({ Repository: `start-command-resume/${uuid}`, Tag: '1', ID: imageId, CreatedAt: '2026-10-04 18:00:00 +0000 UTC' }));
} else if (args[0] === 'image' && args[1] === 'inspect') console.log(imageId);
else if (args[0] === 'system') console.log(`start-command-resume/${uuid}  1  bbbbbbbbbbbb  3 days ago  9.4GB  5GB  4.4GB  1`);
else if (args[0] === 'rm' && scenario === 'restart-race') {
  console.error('conflict: container is running');
  process.exit(1);
} else if (args[0] === 'rm' || (args[0] === 'image' && args[1] === 'rm')) console.log(args.at(-1));
else {
  console.error(`Unexpected fixture command: ${args.join(' ')}`);
  process.exit(1);
}
