#!/usr/bin/env node
// Issue #3001 end-to-end check. Run this INSIDE a container that only has the
// Docker socket mounted (the production `hive-mind` topology):
//
//   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
//     -v "$PWD":/repo:ro -v /path/to/static/docker:/usr/local/bin/docker:ro \
//     node:22-alpine node /repo/experiments/issue-3001/probe-from-socket-container.mjs alpine:3
//
// Before the fix the old probe ran `df -Pk /var/lib/docker` in this container,
// which fails ("No such file or directory"/"can't find mount point"), and the
// check silently returned null. The new probe measures through the daemon.
import { checkDockerDiskSpace } from '../../src/docker-disk-space.lib.mjs';

const image = process.argv[2] || null;
const result = await checkDockerDiskSpace(true, { image });
console.log(JSON.stringify(result, null, 2));
process.exit(Number.isFinite(result.availableGiB) ? 0 : 1);
