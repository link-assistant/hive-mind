#!/usr/bin/env node
/**
 * Issue #2187 item D — print what the reclaim plan would do on THIS host.
 * Read-only: it runs `docker image ls`/`docker ps -a`/`docker system df` and
 * prints the plan, never `docker image rm`.
 *
 *   node experiments/issue-2187-docker-image-reclaim.mjs [mode]
 */
import { collectDockerImageReclaimPlan, describeDockerImageReclaimReason, formatDockerImageReclaimSummary, measureDockerReclaimableBytes } from '../src/docker-image-reclaim.lib.mjs';
import { formatBytes } from '../src/cleanup.lib.mjs';

const mode = process.argv[2] || 'superseded';
const reclaimable = await measureDockerReclaimableBytes({});
console.log(`docker system df reclaimable: ${reclaimable == null ? 'unavailable' : formatBytes(reclaimable)}`);

const plan = await collectDockerImageReclaimPlan({ mode });
if (!plan) {
  console.log('docker unavailable — nothing to plan');
  process.exit(0);
}
console.log(`\nmode=${plan.mode}  would reclaim ${formatBytes(plan.reclaimableBytes)} from ${plan.remove.length} image(s):`);
for (const image of plan.remove) console.log(`  - ${formatDockerImageReclaimSummary(image)}\n      ${image.command}`);
console.log(`\nkept ${plan.keep.length} image(s):`);
for (const image of plan.keep) console.log(`  = ${image.reference} (${formatBytes(image.sizeBytes)}) — ${describeDockerImageReclaimReason(image.reason)}`);
