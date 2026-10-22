#!/usr/bin/env node
// Issue #3583: run the "pre-existing root-owned volume" scenario against any
// checkout of Hive Mind's src/ (default: this one) with this branch's Docker
// simulator, and print the volume owner and files after the next sidecar start.
//
//   git worktree add /tmp/hm-main origin/main && ln -s "$PWD/node_modules" /tmp/hm-main/
//   node experiments/issue-3583-before-after.mjs /tmp/hm-main/src   # before
//   node experiments/issue-3583-before-after.mjs                     # after
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOX_OWNER, ROOT_OWNER, createDockerSimulator } from '../tests/formal-ai-docker-simulator.mjs';

const srcDir = path.resolve(process.argv[2] || new URL('../src', import.meta.url).pathname);
const sidecarLib = await import(pathToFileURL(path.join(srcDir, 'formal-ai-sidecar.lib.mjs')).href);
const { FORMAL_AI_IMAGE_REPOSITORY } = await import(pathToFileURL(path.join(srcDir, 'formal-ai-image.lib.mjs')).href);
const { FORMAL_AI_BOOTSTRAP_VERSION } = await import(pathToFileURL(path.join(srcDir, 'formal-ai-version.lib.mjs')).href);

const image = `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-formal-ai-3583-exp-'));
const env = { HIVE_MIND_STATE_DIR: dir, HIVE_MIND_LOG_DIR: path.join(dir, 'logs') };
const docker = createDockerSimulator({ images: { [image]: 'sha256:sidecar' } });
const volume = docker.seedVolume(sidecarLib.FORMAL_AI_MEMORY_VOLUME_NAME, { owner: ROOT_OWNER });
const lines = [];
try {
  await sidecarLib.acquireFormalAiSidecar({ sessionId: 'task-1', env, run: docker.run, log: async line => void lines.push(line), healthAttempts: 1, healthDelayMs: 0, sleepImpl: async () => {} });
} catch (error) {
  lines.push(`acquire threw: ${error.message}`);
}
const sidecarStdout = (await docker.run('docker', ['logs', sidecarLib.FORMAL_AI_SIDECAR_CONTAINER_NAME]).catch(() => ({ stdout: '' }))).stdout;
const archives = fs.existsSync(env.HIVE_MIND_LOG_DIR) ? fs.readdirSync(env.HIVE_MIND_LOG_DIR) : [];
console.log(
  JSON.stringify(
    {
      src: srcDir,
      volumeOwner: volume.owner,
      fixed: volume.owner === BOX_OWNER,
      filesWritten: [...volume.files],
      chownCalls: docker.calls.filter(call => call.includes('--entrypoint chown')).length,
      loggingFailuresOnStdout: (String(sidecarStdout).match(/logging_failure/g) || []).length,
      hiveMindLog: lines,
    },
    null,
    2
  )
);
fs.rmSync(dir, { recursive: true, force: true });
