#!/usr/bin/env node

/**
 * Replay the three real-client tasks issue #2207 references, against the Formal
 * AI release this PR's fix makes the sidecar boot.
 *
 * The point is not that the clients succeed — that depends on Formal AI itself,
 * and issue #2209 says so ("If an independently tracked Formal AI defect still
 * prevents delivery, report that blocker explicitly"). The point is that the
 * task is served by the *accepted* release rather than by the bootstrap one,
 * and that whatever the run produces can be checked against the remote.
 *
 * Usage:
 *   node experiments/issue-2209/replay-real-clients.mjs [--only <tool>] [--task <n>]
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { FORMAL_AI_IMAGE_REPOSITORY } from '../../src/formal-ai-image.lib.mjs';
import { buildFormalAiTaskEnv } from '../../src/formal-ai-isolation.lib.mjs';
import { FORMAL_AI_MEMORY_VOLUME_NAME, FORMAL_AI_SIDECAR_CONTAINER_NAME, FORMAL_AI_SIDECAR_NETWORK_NAME, acquireFormalAiSidecar, releaseFormalAiSidecar, writeFormalAiSidecarState } from '../../src/formal-ai-sidecar.lib.mjs';
import { updateFormalAiSidecarWhenIdle } from '../../src/formal-ai-updater.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../../src/formal-ai-version.lib.mjs';

const execFileAsync = promisify(execFile);
const docker = async args => (await execFileAsync('docker', args, { maxBuffer: 32 * 1024 * 1024 })).stdout.trim();
const log = async message => console.log(message);

/** The three tasks named in issue #2207's "Production evidence" section. */
const TASKS = [
  { tool: 'codex', language: 'Rust', repo: 'konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c' },
  { tool: 'claude', language: 'Kotlin', repo: 'konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a' },
  { tool: 'agent', language: 'Scala', repo: 'konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b' },
];

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const only = arg('--only');
const timeoutMs = Number(arg('--timeout', '2400')) * 1000;
const logDir = path.resolve(arg('--log-dir', 'logs/replay'));
fs.mkdirSync(logDir, { recursive: true });

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-replay-'));
const env = { ...process.env, HIVE_MIND_STATE_DIR: stateDir, HIVE_MIND_FORMAL_AI_UPDATE_TAG: 'latest', HIVE_MIND_FORMAL_AI_IMAGE: '' };
const options = { env, log, verbose: true };

const cleanup = async () => {
  for (const args of [
    ['rm', '--force', FORMAL_AI_SIDECAR_CONTAINER_NAME],
    ['network', 'rm', FORMAL_AI_SIDECAR_NETWORK_NAME],
    ['volume', 'rm', FORMAL_AI_MEMORY_VOLUME_NAME],
  ]) {
    await docker(args).catch(() => {});
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
};

/** Run `solve` the way a Formal AI task runs it, and keep the whole transcript. */
const runSolve = async ({ task, sidecar }) => {
  const logFile = path.join(logDir, `${task.tool}-${task.language.toLowerCase()}.log`);
  const stream = fs.createWriteStream(logFile);
  const taskEnv = buildFormalAiTaskEnv({ sidecar, env });
  const args = ['src/solve.mjs', `https://github.com/${task.repo}/issues/1`, '--tool', task.tool, '--model', 'formal-ai', '--verbose', '--no-tool-update'];
  stream.write(`$ node ${args.join(' ')}\nHIVE_MIND_FORMAL_AI_BASE_URL=${taskEnv.HIVE_MIND_FORMAL_AI_BASE_URL}\nHIVE_MIND_FORMAL_AI_SIDECAR_VERSION=${taskEnv.HIVE_MIND_FORMAL_AI_SIDECAR_VERSION}\nHIVE_MIND_FORMAL_AI_SIDECAR_DIGEST=${taskEnv.HIVE_MIND_FORMAL_AI_SIDECAR_DIGEST}\n\n`);
  const child = spawn('node', args, { env: taskEnv, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer);
  stream.end();
  return { logFile, code };
};

/** What issue #2207 asks to assert, read back from the remote rather than the run. */
const inspectRemote = async repo => {
  const gh = async args => (await execFileAsync('gh', args, { maxBuffer: 32 * 1024 * 1024 })).stdout;
  const prs = JSON.parse(await gh(['pr', 'list', '--repo', repo, '--state', 'all', '--json', 'number,title,state,headRefName,url']));
  const results = [];
  for (const pr of prs) {
    const files = JSON.parse(await gh(['pr', 'view', String(pr.number), '--repo', repo, '--json', 'files']));
    const diff = await gh(['pr', 'diff', String(pr.number), '--repo', repo]).catch(() => '');
    const paths = files.files.map(file => file.path);
    results.push({
      number: pr.number,
      url: pr.url,
      state: pr.state,
      files: paths,
      // The three things the issue asks for, checked against the remote diff.
      hasWorkflow: paths.some(file => file.startsWith('.github/workflows/')),
      hasSource: paths.some(file => !file.startsWith('.github/') && file !== '.gitkeep' && !file.endsWith('.md')),
      diffSays: /Hello, World!/.test(diff),
    });
  }
  return results;
};

const evidence = { tasks: [] };
try {
  await cleanup();
  const fromImage = `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;
  console.log(`=== starting from the bootstrap release ${fromImage} ===`);
  await docker(['pull', fromImage]);
  writeFormalAiSidecarState({ image: fromImage, imageDigest: await docker(['image', 'inspect', fromImage, '--format', '{{.Id}}']), leases: [] }, { env });

  console.log('\n=== idle update ===');
  const update = await updateFormalAiSidecarWhenIdle(options);
  evidence.update = { status: update.status, version: update.health?.version ?? null, digest: update.digest };
  console.log(JSON.stringify(evidence.update, null, 2));

  for (const task of TASKS) {
    if (only && only !== task.tool) continue;
    console.log(`\n=== replay: ${task.language} / ${task.tool} ===`);
    const sessionId = `replay-${task.tool}`;
    const sidecar = await acquireFormalAiSidecar({ sessionId, ...options });
    // The whole reason the replay is worth running: the task is served by the
    // release the updater accepted, not by the bootstrap one.
    if (update.status === 'updated') assert.equal(sidecar.imageDigest, update.digest, 'the replayed task is served by the accepted release');
    const health = await (await fetch(`${sidecar.baseUrl}/health`)).json();
    const record = { ...task, servingVersion: health.version, servingDigest: sidecar.imageDigest, imageSource: sidecar.imageSource, baseUrl: sidecar.baseUrl };
    console.log(JSON.stringify(record, null, 2));
    try {
      const { logFile, code } = await runSolve({ task, sidecar });
      record.exitCode = code;
      record.logFile = logFile;
    } finally {
      await releaseFormalAiSidecar({ sessionId, ...options });
    }
    record.remote = await inspectRemote(task.repo);
    console.log(JSON.stringify({ exitCode: record.exitCode, remote: record.remote }, null, 2));
    evidence.tasks.push(record);
  }
} finally {
  await cleanup();
  fs.writeFileSync(path.join(logDir, 'replay-summary.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n=== summary written to ${path.join(logDir, 'replay-summary.json')} ===`);
}
