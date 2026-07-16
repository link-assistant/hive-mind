#!/usr/bin/env node

/**
 * Pre-seed the nested Docker daemon of a Hive Mind DinD container with an image
 * already present on the host, so `--isolation docker` tasks reuse it instead
 * of re-downloading a full copy inside the container.
 *
 * Why this is needed
 * ------------------
 * In our DinD deployment the Telegram bot runs inside `konard/hive-mind-dind`
 * with a *nested* dockerd. When a task launches `docker run konard/hive-mind-dind:...`
 * that `docker run` talks to the nested daemon, whose image store starts empty
 * (the deploy wipes `/var/lib/docker` before `docker commit`). Docker therefore
 * reports "Unable to find image ... locally" and pulls a fresh multi-gigabyte
 * copy on the first task — even though the host's outer daemon already has the
 * exact image. See https://github.com/link-assistant/hive-mind/issues/1879.
 *
 * This script copies the host image into the nested daemon via
 * `docker save | docker exec -i <container> docker load`. Run it once after the
 * container starts (and again after the host image is updated). Once the image
 * is in the nested daemon, isolated tasks reuse it automatically: start-command's
 * native Docker backend runs `docker run` with Docker's default "missing" pull
 * policy, so a locally present image is never re-pulled (issue #1914).
 *
 * Prefer the automatic path. This script is a manual fallback. The durable fix
 * is to let box's host-image passthrough seed the nested daemon on boot by
 * bind-mounting the host Docker socket into the bot container:
 *   -v /var/run/docker.sock:/var/run/host-docker.sock:ro
 *   -e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind"
 * See docs/DOCKER.md ("Host-image passthrough"). Use this script when you cannot
 * change the deployment or need to seed an already-running container immediately.
 *
 * Usage:
 *   node scripts/preload-dind-isolation-image.mjs [--container hive-mind] [--image konard/hive-mind-dind:latest] [--verbose]
 *
 * Defaults match the standard server deployment (container `hive-mind`, image
 * `konard/hive-mind-dind:latest`). Environment overrides:
 *   PRELOAD_CONTAINER, PRELOAD_IMAGE
 */

import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const opts = {
    container: process.env.PRELOAD_CONTAINER || 'hive-mind',
    image: process.env.PRELOAD_IMAGE || 'konard/hive-mind-dind:latest',
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--container' || arg === '-c') opts.container = argv[++i];
    else if (arg.startsWith('--container=')) opts.container = arg.slice('--container='.length);
    else if (arg === '--image' || arg === '-i') opts.image = argv[++i];
    else if (arg.startsWith('--image=')) opts.image = arg.slice('--image='.length);
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

function log(verbose, ...args) {
  if (verbose) console.log('[preload]', ...args);
}

function run(command, args, { capture = false } = {}) {
  return spawnSync(command, args, {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf-8',
  });
}

function printHelp() {
  console.log(`Pre-seed a Hive Mind DinD container's nested Docker daemon with a host image.

Usage:
  node scripts/preload-dind-isolation-image.mjs [options]

Options:
  -c, --container <name>   Target container name (default: hive-mind)
  -i, --image <ref>        Image reference to copy (default: konard/hive-mind-dind:latest)
  -v, --verbose            Verbose output
  -h, --help               Show this help

See https://github.com/link-assistant/hive-mind/issues/1879`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const { container, image, verbose } = opts;
  console.log(`>>> Pre-seeding nested daemon of container '${container}' with image '${image}'`);

  // 1. Verify the host has the image locally; pull it once if missing.
  const hostInspect = run('docker', ['image', 'inspect', image], { capture: true });
  if (hostInspect.status !== 0) {
    console.log(`>>> Host does not have '${image}' yet; pulling once...`);
    const pull = run('docker', ['pull', image]);
    if (pull.status !== 0) {
      console.error(`>>> ERROR: failed to pull '${image}' on the host`);
      return 1;
    }
  } else {
    log(verbose, `host already has ${image}`);
  }

  // 2. Skip the (potentially multi-GB) copy if the nested daemon already has it.
  const nestedInspect = run('docker', ['exec', container, 'docker', 'image', 'inspect', image], { capture: true });
  if (nestedInspect.status === 0) {
    console.log(`>>> Nested daemon already has '${image}'; nothing to do.`);
    return 0;
  }
  log(verbose, `nested daemon is missing ${image}, streaming it in...`);

  // 3. Stream the host image into the nested daemon:
  //    docker save <image> | docker exec -i <container> docker load
  // Use a shell pipeline so the tarball is never written to disk.
  const shellPipeline = `docker save ${image} | docker exec -i ${container} docker load`;
  console.log(`>>> ${shellPipeline}`);
  const result = run('sh', ['-c', shellPipeline]);
  if (result.status !== 0) {
    console.error('>>> ERROR: failed to copy image into the nested daemon');
    return result.status || 1;
  }

  // 4. Confirm.
  const verify = run('docker', ['exec', container, 'docker', 'image', 'inspect', image], { capture: true });
  if (verify.status !== 0) {
    console.error(`>>> ERROR: image '${image}' still not present in nested daemon after load`);
    return 1;
  }
  console.log(`>>> Done. Nested daemon now has '${image}'.`);
  console.log('>>> Isolated tasks now reuse it automatically (native docker backend pulls only when missing).');
  console.log('>>> Tip: to seed automatically on boot, mount the host socket into the bot container:');
  console.log('>>>   -v /var/run/docker.sock:/var/run/host-docker.sock:ro \\');
  console.log('>>>   -e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind"');
  return 0;
}

process.exit(main());
