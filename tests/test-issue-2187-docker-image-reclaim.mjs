#!/usr/bin/env node

/**
 * Issue #2187, item D — prune superseded images after a successful task.
 *
 * `--auto-cleanup` reclaims the workspace; nothing reclaimed images, so the
 * reported host sat on 24 GB of reclaimable image data while the disk gate
 * stopped the run with "no in-flight work can release disk space".
 *
 * The maintainer's constraint on that number is the whole design of this
 * planner: "we actually need to have at least one hive-mind image in the system
 * after the deploy, and it must be reusable inside for all the tasks". A bare
 * `docker image prune -a` cannot promise that, so the plan built here is
 * deliberately narrow:
 *
 *   - dangling images (`<none>:<none>`) that no container references;
 *   - strictly older tags of the Hive Mind repositories only;
 *   - never the newest tag of a repository, never `latest`, never the tag the
 *     isolation runner resolves, never an image a container references, and
 *     never an image ID that a protected tag also points at.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import { assert as check, printSummary, getFailCount } from './test-helpers.mjs';
import { DEFAULT_DOCKER_IMAGE_RECLAIM_MODE, describeDockerImageReclaimReason, formatDockerImageReclaimSummary, normalizeDockerImageReclaimMode, parseDockerImageJsonLines, parseDockerJsonLines, planDockerImageReclaim, reclaimDockerImages } from '../src/docker-image-reclaim.lib.mjs';

const IMAGES = [
  { ID: 'sha256:latest1', Repository: 'konard/hive-mind', Tag: 'latest', CreatedAt: '2026-08-30 10:00:00 +0000 UTC', Size: '12.3GB' },
  { ID: 'sha256:latest1', Repository: 'konard/hive-mind', Tag: 'v2.17.0', CreatedAt: '2026-08-30 10:00:00 +0000 UTC', Size: '12.3GB' },
  { ID: 'sha256:old216', Repository: 'konard/hive-mind', Tag: 'v2.16.0', CreatedAt: '2026-08-20 10:00:00 +0000 UTC', Size: '11.9GB' },
  { ID: 'sha256:old215', Repository: 'konard/hive-mind', Tag: 'v2.15.0', CreatedAt: '2026-08-10 10:00:00 +0000 UTC', Size: '11.5GB' },
  { ID: 'sha256:old214', Repository: 'konard/hive-mind', Tag: 'v2.14.0', CreatedAt: '2026-08-01 10:00:00 +0000 UTC', Size: '11.4GB' },
  { ID: 'sha256:dind17', Repository: 'konard/hive-mind-dind', Tag: 'v2.17.0', CreatedAt: '2026-08-30 11:00:00 +0000 UTC', Size: '13.0GB' },
  { ID: 'sha256:dind16', Repository: 'konard/hive-mind-dind', Tag: 'v2.16.0', CreatedAt: '2026-08-20 11:00:00 +0000 UTC', Size: '12.8GB' },
  { ID: 'sha256:dangle1', Repository: '<none>', Tag: '<none>', CreatedAt: '2026-08-25 09:00:00 +0000 UTC', Size: '4.1GB' },
  { ID: 'sha256:dangle2', Repository: '<none>', Tag: '<none>', CreatedAt: '2026-08-26 09:00:00 +0000 UTC', Size: '2.0GB' },
  { ID: 'sha256:pg16', Repository: 'postgres', Tag: '16', CreatedAt: '2026-08-28 09:00:00 +0000 UTC', Size: '400MB' },
  { ID: 'sha256:pg15', Repository: 'postgres', Tag: '15', CreatedAt: '2026-01-28 09:00:00 +0000 UTC', Size: '390MB' },
];

const CONTAINERS = [
  // A finished isolation task still referencing an older tag.
  { ID: 'c1', Image: 'konard/hive-mind:v2.15.0', Names: '11111111-1111-4111-8111-111111111111', State: 'exited', Status: 'Exited (0) 2 hours ago' },
  // A running container on a dangling image (the image ID is what docker prints).
  { ID: 'c2', Image: 'sha256:dangle2', Names: 'router-sidecar', State: 'running', Status: 'Up 3 minutes' },
];

const toJsonLines = records => records.map(record => JSON.stringify(record)).join('\n');

const plan = planDockerImageReclaim({
  images: parseDockerImageJsonLines(toJsonLines(IMAGES)),
  containers: parseDockerJsonLines(toJsonLines(CONTAINERS)),
  // The deployed host pins the isolation tag, so that exact image must survive.
  protectedReferences: ['konard/hive-mind:v2.14.0'],
});

const removed = new Set(plan.remove.map(item => item.reference));
const keptBy = reference => plan.keep.find(item => item.reference === reference);

// --- parsing ----------------------------------------------------------------
const parsedImages = parseDockerImageJsonLines(toJsonLines(IMAGES));
check(parsedImages.length === IMAGES.length, 'parseDockerImageJsonLines: every `docker image ls --format {{json .}}` line is parsed');
check(parsedImages[0].reference === 'konard/hive-mind:latest', 'parseDockerImageJsonLines: repository and tag are joined into a reference');
check(parsedImages[7].dangling === true, 'parseDockerImageJsonLines: `<none>:<none>` is recognised as dangling');
check(parsedImages[2].sizeBytes > 11 * 1000 ** 3, 'parseDockerImageJsonLines: the human-readable size is parsed into bytes');
check(parseDockerImageJsonLines('not json\n\n').length === 0, 'parseDockerImageJsonLines: junk lines are ignored, not thrown on');

// --- what gets removed ------------------------------------------------------
check(removed.has('konard/hive-mind:v2.16.0'), 'removes a strictly older Hive Mind tag');
check(removed.has('konard/hive-mind-dind:v2.16.0'), 'removes a strictly older Hive Mind dind tag');
check(removed.has('sha256:dangle1'), 'removes a dangling image no container references');
check(plan.remove.length === 3, `removes exactly the three superseded/dangling images (got ${[...removed].join(', ') || 'none'})`);

// --- what must survive ------------------------------------------------------
check(keptBy('konard/hive-mind:latest')?.reason === 'protected_tag', '`latest` is never removed');
check(keptBy('konard/hive-mind:v2.17.0')?.reason === 'newest_tag', 'the newest tag of a repository is never removed');
check(keptBy('konard/hive-mind-dind:v2.17.0')?.reason === 'newest_tag', 'the newest tag survives even for a repository without `latest`');
check(keptBy('konard/hive-mind:v2.15.0')?.reason === 'in_use_by_container', 'an image a container references is never removed, even when superseded');
check(keptBy('konard/hive-mind:v2.14.0')?.reason === 'protected_reference', 'the pinned isolation image tag is never removed');
check(keptBy('sha256:dangle2')?.reason === 'in_use_by_container', 'a dangling image a running container uses is never removed');
check(keptBy('postgres:15')?.reason === 'unmanaged_repository', 'superseded tags of unrelated repositories are never touched');
check(keptBy('postgres:16')?.reason === 'unmanaged_repository', 'unrelated repositories are reported but left alone');

// The maintainer's constraint, asserted directly rather than implied.
for (const repository of ['konard/hive-mind', 'konard/hive-mind-dind']) {
  const survivors = plan.keep.filter(item => item.repository === repository);
  check(survivors.length > 0, `at least one ${repository} image survives the plan`);
}
check(!plan.remove.some(item => item.id === 'sha256:latest1'), 'no image ID shared with a protected tag is removed');

// --- commands and totals ----------------------------------------------------
check(plan.remove.find(item => item.reference === 'konard/hive-mind:v2.16.0')?.command === 'docker image rm konard/hive-mind:v2.16.0', 'a superseded tag is removed by reference, so other tags of the same ID survive');
check(plan.remove.find(item => item.dangling)?.command === 'docker image rm sha256:dangle1', 'a dangling image is removed by ID');
check(plan.reclaimableBytes === plan.remove.reduce((sum, item) => sum + item.sizeBytes, 0), 'reclaimableBytes is the size of everything the plan removes');
check(formatDockerImageReclaimSummary(plan.remove[0]).includes(plan.remove[0].reference), 'the summary names the image it describes');
check(describeDockerImageReclaimReason('superseded_tag').length > 'superseded_tag'.length, 'reasons have a human-readable description');

// --- modes ------------------------------------------------------------------
check(normalizeDockerImageReclaimMode(undefined) === DEFAULT_DOCKER_IMAGE_RECLAIM_MODE, 'the default mode is used when nothing is configured');
check(normalizeDockerImageReclaimMode('off') === 'none' && normalizeDockerImageReclaimMode('false') === 'none', 'the mode can be turned off');
check(normalizeDockerImageReclaimMode('dangling') === 'dangling', 'a dangling-only mode is available');
const danglingOnly = planDockerImageReclaim({ images: parseDockerImageJsonLines(toJsonLines(IMAGES)), containers: parseDockerJsonLines(toJsonLines(CONTAINERS)), mode: 'dangling' });
check(danglingOnly.remove.length === 1 && danglingOnly.remove[0].id === 'sha256:dangle1', 'mode=dangling removes only unreferenced dangling images');
check(
  danglingOnly.keep.some(item => item.reference === 'konard/hive-mind:v2.16.0' && item.reason === 'mode_dangling_only'),
  'mode=dangling keeps superseded tags, with the reason'
);
const noneMode = planDockerImageReclaim({ images: parseDockerImageJsonLines(toJsonLines(IMAGES)), mode: 'none' });
check(noneMode.remove.length === 0, 'mode=none removes nothing');
check(planDockerImageReclaim({}).remove.length === 0, 'an empty image list plans nothing (docker unavailable)');

// --- execution --------------------------------------------------------------
const executed = [];
const execOk = async (file, args) => {
  executed.push([file, ...args].join(' '));
  return { stdout: '', stderr: '' };
};
const dryRunResult = await reclaimDockerImages({ plan, exec: execOk, dryRun: true });
check(executed.length === 0 && dryRunResult.removed.length === 0, 'a dry run executes no docker command');

executed.length = 0;
const result = await reclaimDockerImages({ plan, exec: execOk });
check(executed.length === 3 && executed.every(command => command.startsWith('docker image rm ')), 'each planned removal runs `docker image rm`');
check(result.removed.length === 3 && result.reclaimedBytes === plan.reclaimableBytes, 'a successful reclaim reports what it removed');

executed.length = 0;
const execFails = async (file, args) => {
  executed.push([file, ...args].join(' '));
  // Docker refuses to delete an image that is a parent of another image; that
  // is normal, and must not turn a finished task into a failure.
  throw new Error('conflict: unable to delete (must be forced)');
};
const failed = await reclaimDockerImages({ plan, exec: execFails });
check(executed.length === 3, 'a failing removal does not abort the remaining ones');
check(failed.removed.length === 0 && failed.failed.length === 3 && failed.reclaimedBytes === 0, 'failures are reported, not thrown');

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
