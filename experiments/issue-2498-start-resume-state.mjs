/** Finite explicit-resume reproduction against an unpacked start-command. */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSessionExitFromLog } from '../src/isolation-runner.parsers.lib.mjs';

const packagePath = process.argv[2];
if (!packagePath) throw new Error('Usage: node experiments/issue-2498-start-resume-state.mjs /absolute/start-command/package');
const require = createRequire(path.join(packagePath, 'package.json'));
const { resumeExecution } = require('./src/lib/execution-resume.js');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'start-resume-2498-'));
const logPath = path.join(dir, 'execution.log');
try {
  await fs.writeFile(logPath, '==========\nFinished: 2026-01-01 00:00:00.000\nExit Code: 137\n');
  const record = { uuid: 'synthetic-execution', command: 'echo continued', logPath, startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:00:01Z', status: 'killed', exitCode: 137, oomKilled: true, memoryExhausted: true, memoryExhaustedReason: 'cgroup-oom-killer', cgroupMemory: { oomKills: 1, oomEvents: 1, limitBytes: 1024 }, options: { isolated: 'docker', isolationMode: 'detached', sessionName: 'old-session' } };
  let saved;
  const result = await resumeExecution(
    {
      get: () => record,
      save: value => {
        saved = value;
      },
    },
    record.uuid,
    { probe: () => ({ alive: false, state: 'stopped' }), runner: () => ({ success: true, stdout: 'mock-container-id' }), startWatcher: () => {}, outputFormat: 'json' }
  );
  console.log(JSON.stringify({ version: require('./package.json').version, result, saved, latestFooter: readSessionExitFromLog(logPath), appendedLifecycleBoundary: (await fs.readFile(logPath, 'utf8')).includes('resume') }, null, 2));
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
