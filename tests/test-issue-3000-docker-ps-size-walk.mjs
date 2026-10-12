#!/usr/bin/env node

/**
 * Issue #3000 — `docker ps --format '{{json .}}'` makes dockerd walk every
 * container's writable layer.
 *
 * The docker CLI asks the daemon for container sizes (`size=1`) whenever the
 * template uses `.Size`, and `{{json .}}` uses every field. On the production
 * host that took 2.5 s instead of 0.35 s, and it failed whenever a task deleted
 * a file mid-walk (`snapshotter.Usage failed ... lstat ...: no such file or
 * directory`). Two callers then reported "no containers": `/cleanup` saw no
 * task containers, and the image reclaim plan treated every image as unused.
 *
 * These checks pin the fix:
 *   - the `docker ps` format names only the fields we read, so `.Size` is never
 *     requested, and the existing JSON-lines parsers still parse its output;
 *   - no `docker ps` call in src/ uses `{{json .}}` again;
 *   - a failed `docker ps` means "no reclaim plan", not "no containers";
 *   - `/cleanup` can tell "no task containers" from "could not list them".
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3000
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assert as check, printSummary, getFailCount } from './test-helpers.mjs';
import { DOCKER_PS_FIELDS, DOCKER_PS_JSON_FORMAT, buildDockerJsonFormat, dockerPsArgs } from '../src/docker-ps-format.lib.mjs';
import { listDockerIsolationContainers, parseDockerPsJsonLines, readDockerIsolationContainers } from '../src/cleanup.os.lib.mjs';
import { collectDockerImageReclaimPlan } from '../src/docker-image-reclaim.lib.mjs';

const TASK = '11111111-1111-4111-8111-111111111111';
const SNAPSHOTTER_ERROR = 'Error response from daemon: snapshotter.Usage failed for 698e6ba296d2: lstat /var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/7214/fs/tmp/ccCBKh2I.s: no such file or directory';

/**
 * Render a `{{json .Field}}` template the way the docker CLI does, from a
 * container record — enough to prove the format produces parseable JSON lines.
 */
const renderDockerJsonTemplate = (format, record) =>
  format.replace(/\{\{json \.([A-Za-z]+)\}\}/g, (_, field) => {
    if (!(field in record)) throw new Error(`template references unknown field .${field}`);
    return JSON.stringify(record[field]);
  });

// What `docker ps -a --format '{{json .}}'` printed on docker 29.8.2 for a task
// container (Size included — that field is what costs the layer walk).
const FULL_RECORD = {
  Command: '"sleep 60"',
  CreatedAt: '2026-10-12 00:01:50 +0000 UTC',
  HealthStatus: 'none',
  ID: '6ba18792b561',
  Image: 'konard/hive-mind:2.35.3',
  Labels: 'com.example=1',
  LocalVolumes: '0',
  Mounts: '',
  Names: TASK,
  Networks: 'bridge',
  Platform: null,
  Ports: '',
  RunningFor: '2 hours ago',
  Size: '4.35GB (virtual 28.9GB)',
  State: 'running',
  Status: 'Up 2 hours',
};

// --- the format itself -------------------------------------------------------
check(!/\.Size\b/.test(DOCKER_PS_JSON_FORMAT), 'the docker ps format never references .Size (that is what makes the CLI send size=1)');
check(!DOCKER_PS_JSON_FORMAT.includes('{{json .}}'), 'the docker ps format names its fields instead of {{json .}}');
check(
  ['ID', 'Names', 'Image', 'State', 'Status', 'Labels'].every(field => DOCKER_PS_FIELDS.includes(field)),
  'the format keeps every field the parsers read (ID, Names, Image, State, Status, Labels)'
);
check(DOCKER_PS_JSON_FORMAT === '{"ID":{{json .ID}},"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}', 'the format is exactly the one proposed in the issue');
check(buildDockerJsonFormat(['ID']) === '{"ID":{{json .ID}}}', 'buildDockerJsonFormat renders a one-field object');

let rendered = null;
try {
  rendered = renderDockerJsonTemplate(DOCKER_PS_JSON_FORMAT, FULL_RECORD);
} catch (error) {
  check(false, `the format renders against a real docker ps record: ${error.message}`);
}
const parsedRecord = rendered === null ? null : JSON.parse(rendered);
check(parsedRecord && parsedRecord.Names === TASK && parsedRecord.State === 'running' && !('Size' in parsedRecord), 'a rendered line is valid JSON without Size');

const parsedTasks = parseDockerPsJsonLines(rendered ?? '');
check(parsedTasks.length === 1 && parsedTasks[0].id === '6ba18792b561' && parsedTasks[0].running === true && parsedTasks[0].image === 'konard/hive-mind:2.35.3', 'parseDockerPsJsonLines still parses the explicit-field output');

check(JSON.stringify(dockerPsArgs()) === JSON.stringify(['ps', '--all', '--format', DOCKER_PS_JSON_FORMAT]), 'dockerPsArgs lists every container with the explicit format');

// --- no `docker ps ... {{json .}}` anywhere in src/ --------------------------
const SRC = new URL('../src/', import.meta.url).pathname;
const offenders = [];
for (const file of readdirSync(SRC)) {
  if (!/\.(mjs|js|cjs)$/.test(file)) continue;
  const lines = readFileSync(join(SRC, file), 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (/^\s*(\*|\/\/)/.test(line)) return;
    // `docker ps` / `docker container ls` with a whole-record template.
    if (/\{\{\s*json\s+\.\s*\}\}/.test(line) && /['"`](ps|container)['"`]|docker\s+(ps|container\s+ls)/.test(line)) offenders.push(`src/${file}:${index + 1}`);
    // An explicit `--size` / `-s` on `docker ps` is the same walk, asked for directly.
    if (/['"`]ps['"`]/.test(line) && /['"`](--size|-s)['"`]/.test(line)) offenders.push(`src/${file}:${index + 1}`);
  });
}
check(offenders.length === 0, `no docker ps call in src/ asks for sizes (found: ${offenders.join(', ') || 'none'})`);

// --- /cleanup: listDockerIsolationContainers ---------------------------------
const calls = [];
const execListing = (file, args) => {
  calls.push([file, ...args]);
  return renderDockerJsonTemplate(DOCKER_PS_JSON_FORMAT, FULL_RECORD);
};
const listed = listDockerIsolationContainers({ exec: execListing });
check(calls.length === 1 && calls[0][0] === 'docker' && calls[0][1] === 'ps', '/cleanup lists containers with one docker ps call');
check(calls.length === 1 && !calls[0].includes('{{json .}}') && !calls[0].some(arg => /\.Size\b/.test(arg)), '/cleanup no longer passes {{json .}} (no size walk)');
check(listed.length === 1 && listed[0].name === TASK, '/cleanup still finds the task container');

const execSnapshotterFailure = () => {
  const error = new Error('Command failed: docker ps');
  error.status = 1;
  error.stderr = `${SNAPSHOTTER_ERROR}\n`;
  throw error;
};
const failedRead = readDockerIsolationContainers({ exec: execSnapshotterFailure });
check(failedRead.containers.length === 0 && failedRead.error && failedRead.error.includes('snapshotter.Usage failed'), 'a failed docker ps is reported with the daemon error, not as "no containers"');
check(listDockerIsolationContainers({ exec: execSnapshotterFailure }).length === 0, 'listDockerIsolationContainers keeps returning [] on failure (callers still never remove anything)');

const execNoDocker = () => {
  const error = new Error('spawnSync docker ENOENT');
  error.code = 'ENOENT';
  throw error;
};
const noDocker = readDockerIsolationContainers({ exec: execNoDocker });
check(noDocker.containers.length === 0 && noDocker.error === null && noDocker.available === false, 'no docker binary is "docker unavailable", not an error');

const emptyRead = readDockerIsolationContainers({ exec: () => '' });
check(emptyRead.containers.length === 0 && emptyRead.error === null && emptyRead.available === true, 'an empty docker ps is "no containers"');

// --- image reclaim plan ------------------------------------------------------
const IMAGES = [
  { ID: 'sha256:new', Repository: 'konard/hive-mind', Tag: '2.35.3', CreatedAt: '2026-10-11 10:00:00 +0000 UTC', Size: '12.3GB' },
  { ID: 'sha256:old', Repository: 'konard/hive-mind', Tag: '2.35.2', CreatedAt: '2026-10-10 10:00:00 +0000 UTC', Size: '12.1GB' },
];
const imageLines = IMAGES.map(image => JSON.stringify(image)).join('\n');
const runningOnOldImage = renderDockerJsonTemplate(DOCKER_PS_JSON_FORMAT, { ...FULL_RECORD, Image: 'konard/hive-mind:2.35.2' });

const reclaimCalls = [];
const reclaimExec =
  ({ psFails }) =>
  async (file, args) => {
    reclaimCalls.push([file, ...args]);
    if (args[0] === 'image' && args[1] === 'ls') return { stdout: imageLines, stderr: '' };
    if (args[0] === 'ps') {
      if (psFails) {
        const error = new Error(`Command failed: docker ${args.join(' ')}\n${SNAPSHOTTER_ERROR}`);
        error.stderr = SNAPSHOTTER_ERROR;
        throw error;
      }
      return { stdout: runningOnOldImage, stderr: '' };
    }
    throw new Error(`unexpected docker ${args.join(' ')}`);
  };

const plan = await collectDockerImageReclaimPlan({ exec: reclaimExec({ psFails: false }), env: {}, mode: 'superseded', protectedReferences: [] });
const psCall = reclaimCalls.find(call => call[1] === 'ps');
check(psCall && !psCall.includes('{{json .}}') && !psCall.some(arg => /\.Size\b/.test(arg)), 'the reclaim plan lists containers without asking for sizes');
check(plan && plan.remove.length === 0 && plan.keep.some(image => image.reference === 'konard/hive-mind:2.35.2' && image.reason === 'in_use_by_container'), 'an image a container uses is kept');

const failedPlan = await collectDockerImageReclaimPlan({ exec: reclaimExec({ psFails: true }), env: {}, mode: 'superseded', protectedReferences: [] });
check(failedPlan === null, 'a failed docker ps means "no plan" (null), so in-use images are neither counted as reclaimable nor removed');

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
