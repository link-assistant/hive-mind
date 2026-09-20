#!/usr/bin/env node
/**
 * Smoke check for the on-demand Formal AI sidecar module (issue #2146).
 *
 * Runs without Docker: every `docker` call is a recorded stub, so this shows the
 * exact argv Hive Mind would issue for acquire → attach → release.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { acquireFormalAiSidecar, attachTaskToFormalAiNetwork, buildFormalAiSidecarRunArgs, isFormalAiTask, readFormalAiSidecarState, releaseFormalAiSidecar, resolveFormalAiSidecarBaseUrl, resolveFormalAiSidecarImage } from '../src/formal-ai-sidecar.lib.mjs';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-sidecar-'));
const env = { HIVE_MIND_STATE_DIR: stateDir };
const calls = [];
let sidecarExists = false;

const run = async (command, args) => {
  calls.push([command, ...args].join(' '));
  const joined = args.join(' ');
  if (joined.startsWith('inspect hive-mind-formal-ai ')) {
    if (!sidecarExists) throw new Error('No such object');
    return { stdout: 'true|ghcr.io/link-assistant/formal-ai:0.339.1|sha256:abc\n' };
  }
  if (args[0] === 'inspect') return { stdout: 'true|task-image|sha256:task\n' };
  if (joined.startsWith('network inspect')) throw new Error('No such network');
  if (joined.startsWith('volume inspect')) throw new Error('No such volume');
  if (args[0] === 'run' && args[1] === '--detach') {
    sidecarExists = true;
    return { stdout: 'container-id\n' };
  }
  if (args[0] === 'exec') return { stdout: JSON.stringify({ version: '0.339.1', memory: { schema_version: 2, compatible: true, migration_required: false, migration_state: 'ready' } }) };
  return { stdout: '' };
};

console.log('image           :', resolveFormalAiSidecarImage(env));
console.log('base url        :', resolveFormalAiSidecarBaseUrl());
console.log('formal-ai task? :', isFormalAiTask({ args: ['--model', 'formal-ai'] }), isFormalAiTask({ args: ['--model', 'opus'] }));
console.log('run argv        :', JSON.stringify(buildFormalAiSidecarRunArgs({ image: 'ghcr.io/link-assistant/formal-ai:0.339.1', env })));

const lease = await acquireFormalAiSidecar({ sessionId: 'task-a', tool: 'claude', model: 'formal-ai', env, run, log: async m => console.log('  log:', m) });
console.log('acquire         :', JSON.stringify({ baseUrl: lease.baseUrl, leaseCount: lease.leaseCount }));
await attachTaskToFormalAiNetwork({ sessionId: 'task-a', run });

const second = await acquireFormalAiSidecar({ sessionId: 'task-b', tool: 'codex', model: 'formal-ai', env, run, log: async m => console.log('  log:', m) });
console.log('second lease    :', second.leaseCount);

const firstRelease = await releaseFormalAiSidecar({ sessionId: 'task-a', env, run, log: async m => console.log('  log:', m) });
console.log('release #1      :', JSON.stringify(firstRelease));
const secondRelease = await releaseFormalAiSidecar({ sessionId: 'task-b', env, run, log: async m => console.log('  log:', m) });
console.log('release #2      :', JSON.stringify(secondRelease));
console.log('final state     :', JSON.stringify(readFormalAiSidecarState({ env })));
console.log('\ndocker calls:');
for (const call of calls) console.log('  ', call);
console.log(
  '\nvolume removed? ',
  calls.some(c => c.includes('volume rm'))
);
