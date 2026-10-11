#!/usr/bin/env node
/**
 * Issue #2917 experiment: do the attribution markers survive the way
 * start-command resumes a docker task (`docker commit` + `docker run` of the
 * snapshot under `<name>-resume-<n>`)? And do container labels?
 *
 * Usage: node experiments/issue-2917-docker-task-containers.mjs
 * Needs a docker daemon and the alpine:3.20 image. Cleans up after itself.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { listRunningTaskContainers } from '../src/docker-task-containers.lib.mjs';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const uuid = randomUUID();
const resumed = `${uuid}-resume-1`;
const unmarked = randomUUID();
const snapshot = `start-command-resume/${uuid}:1`;
const cleanup = () => {
  for (const name of [uuid, resumed, unmarked]) {
    try {
      docker('rm', '-f', name);
    } catch {}
  }
  try {
    docker('rmi', '-f', snapshot);
  } catch {}
};

try {
  // 1. What hive-mind launches: markers as -e vars (start-command passes them through) and a label to compare.
  docker('run', '-d', '--name', uuid, '--label', 'hive-mind.tool=codex', '-e', `HIVE_MIND_PARENT_SESSION_ID=${uuid}`, '-e', 'HIVE_MIND_TOOL=codex', '-e', 'HIVE_MIND_TASK_URL=https://github.com/link-assistant/router/issues/724', 'alpine:3.20', 'sh', '-c', "sleep 120 # exec 'solve' 'https://github.com/link-assistant/router/issues/724' '--tool' 'codex'");
  // 2. An older task container (no markers): attribution must fall back to the command.
  docker('run', '-d', '--name', unmarked, 'alpine:3.20', 'sh', '-c', "sleep 120 # exec 'solve' 'https://github.com/link-assistant/router/issues/725' '--tool' 'codex'");
  // 3. start-command's snapshot resume: commit, then run the snapshot WITHOUT re-passing labels.
  docker('commit', uuid, snapshot);
  docker('rm', '-f', uuid);
  docker('run', '-d', '--name', resumed, snapshot, 'sh', '-c', "sleep 120 # exec 'solve' 'https://github.com/link-assistant/router/issues/724' '--tool' 'codex'");

  const labelAfterCommit = docker('inspect', '-f', '{{index .Config.Labels "hive-mind.tool"}}', resumed);
  console.log(`label hive-mind.tool on resumed container: ${JSON.stringify(labelAfterCommit)}`);

  const { available, containers } = await listRunningTaskContainers({ verbose: true });
  console.log(JSON.stringify({ available, containers: containers.filter(c => [resumed, unmarked].includes(c.name)) }, null, 2));
} finally {
  cleanup();
}
