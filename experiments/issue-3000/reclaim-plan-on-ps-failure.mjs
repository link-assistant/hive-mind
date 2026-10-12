#!/usr/bin/env node
// Issue #3000 experiment: what the image reclaim plan does when `docker ps`
// fails with the snapshotter error. Pass the module to test (default: current).
//
//   node experiments/issue-3000/reclaim-plan-on-ps-failure.mjs [path/to/docker-image-reclaim.lib.mjs]
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const modulePath = path.resolve(process.argv[2] || 'src/docker-image-reclaim.lib.mjs');
const { collectDockerImageReclaimPlan } = await import(pathToFileURL(modulePath).href);

const images = [
  { ID: 'sha256:new', Repository: 'konard/hive-mind', Tag: '2.35.3', CreatedAt: '2026-10-11 10:00:00 +0000 UTC', Size: '12.3GB' },
  // A running task still uses this older tag.
  { ID: 'sha256:old', Repository: 'konard/hive-mind', Tag: '2.35.2', CreatedAt: '2026-10-10 10:00:00 +0000 UTC', Size: '12.1GB' },
];
const exec = async (file, args) => {
  console.log(`$ ${file} ${args.join(' ')}`);
  if (args[0] === 'image') return { stdout: images.map(image => JSON.stringify(image)).join('\n') };
  const error = new Error('Error response from daemon: snapshotter.Usage failed for 698e6ba296d2: lstat /var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/7214/fs/tmp/ccCBKh2I.s: no such file or directory');
  throw error;
};

const plan = await collectDockerImageReclaimPlan({ exec, env: {}, mode: 'superseded', protectedReferences: [] });
if (plan === null) console.log('plan: null (no plan — nothing counted, nothing removed)');
else console.log(`plan: remove ${plan.remove.map(image => image.reference).join(', ') || '(nothing)'}; reclaimable ${plan.reclaimableBytes} bytes`);
