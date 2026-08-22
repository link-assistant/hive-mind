/**
 * On-demand Formal AI sidecar lifecycle (issue #2146, PR #2147 review).
 *
 * The maintainer's review asked for a container that exists only while Formal
 * AI work exists:
 *
 *   1. start the Formal AI container and connect it to the task's container
 *      over an *internal* Docker network only, and only while tasks run;
 *   2. stop it when no Formal AI task is running;
 *   3. update it to the newest published image while it is stopped/idle;
 *   4. preserve memory between tasks and across container replacement.
 *
 * This module owns (1), (2) and (4); `./formal-ai-updater.lib.mjs` owns (3) and
 * reuses the same durable state and the same exclusive lock so an update can
 * never interleave with a task launch.
 *
 * Design notes that are easy to get wrong and therefore stated explicitly:
 *
 * - **Leases, not a boolean.** Concurrent `/solve --model formal-ai` runs share
 *   one sidecar. Each task holds a named lease; the sidecar is stopped only
 *   after the last lease is released. A crashed bot cannot leak a lease
 *   forever, because every reconcile re-derives liveness from Docker itself.
 * - **Truth comes from Docker.** The JSON store is a cache. `reconcile()` drops
 *   leases whose task container is gone and adopts a sidecar that is running
 *   without a store entry, so a bot restart converges instead of orphaning.
 * - **The memory volume is never removed.** Stopping the sidecar, replacing its
 *   image, or rolling an update back all leave `hive-mind-formal-ai-memory`
 *   in place; that named volume is the persisted memory the review requires.
 * - **`docker network connect`, not `docker run --network`.** A single
 *   `docker run --network` *replaces* the container's default bridge, so an
 *   `--internal` network passed that way would also cut the task off from
 *   GitHub and the package registries. start-command 0.32.0+ (start#156 →
 *   start PR #157) can express both networks at launch by repeating
 *   `--network`, implemented upstream as the same create → connect → start
 *   sequence; Hive Mind keeps issuing the additive `docker network connect`
 *   itself while the start gate still holds the task command back, because
 *   that stays fail-closed on any installed start-command version instead of
 *   silently collapsing to one network on pre-0.32.0 parsers.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/hive-mind/pull/2147
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { FORMAL_AI_MINIMUM_VERSION, isFormalAiVersionAtLeast } from './formal-ai-version.lib.mjs';
import { ensureFormalAiSidecarImage, resolveFormalAiSidecarImage } from './formal-ai-image.lib.mjs';
import { isFormalAiModel } from './formal-ai-model.lib.mjs';
import { getModelFromArgs } from './model-args.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';

const execFileAsync = promisify(execFile);

/** Container, network, volume and alias names. Stable so reconciliation works across restarts. */
export const FORMAL_AI_SIDECAR_CONTAINER_NAME = 'hive-mind-formal-ai';
export const FORMAL_AI_SIDECAR_NETWORK_NAME = 'hive-mind-formal-ai';
/**
 * The DNS alias task containers resolve. Deliberately unchanged from the
 * Compose deployment so `HIVE_MIND_FORMAL_AI_BASE_URL` keeps its value and
 * existing operator configuration keeps working.
 */
export const FORMAL_AI_SIDECAR_NETWORK_ALIAS = 'link-assistant-formal-ai';
export const FORMAL_AI_MEMORY_VOLUME_NAME = 'hive-mind-formal-ai-memory';
export const FORMAL_AI_SIDECAR_PORT = 8080;

/**
 * Where the memory volume is mounted inside the sidecar. The published image's
 * DinD entrypoint runs application commands as `box`, so upstream's own
 * released-to-candidate upgrade fixture uses `/home/box/.formal-ai` rather than
 * the image's `/root/.formal-ai` default.
 *
 * @see https://github.com/link-assistant/formal-ai/blob/main/experiments/issue_982_memory_upgrade/run_container_upgrade.sh
 */
export const FORMAL_AI_MEMORY_MOUNT = '/home/box/.formal-ai';
export const FORMAL_AI_MEMORY_PATH = `${FORMAL_AI_MEMORY_MOUNT}/memory.lino`;

/**
 * Image published by every Formal AI release (`:latest` plus the bare version).
 *
 * Re-exported from `formal-ai-image.lib.mjs`, which owns image resolution since
 * issue #2154 taught us that "which image" and "is it actually pullable" are the
 * same question.
 */
export { FORMAL_AI_IMAGE_REPOSITORY, resolveFormalAiSidecarImage, resolveFormalAiSidecarImageCandidates } from './formal-ai-image.lib.mjs';

/** Applied to the sidecar, its network and its volume so reconciliation can find them. */
export const FORMAL_AI_SIDECAR_LABEL = 'com.link-assistant.hive-mind.formal-ai';

const STATE_FILE_NAME = 'formal-ai-sidecar.json';
const SIDECAR_LOCK_NAME = 'formal-ai-sidecar';
const DEFAULT_DOCKER_TIMEOUT_MS = 120_000;
// Pulling a sidecar image is the one Docker call that legitimately takes many
// minutes, so it gets its own budget instead of the general command timeout.
const DEFAULT_IMAGE_TIMEOUT_MS = 600_000;
const DEFAULT_HEALTH_ATTEMPTS = 60;
const DEFAULT_HEALTH_DELAY_MS = 1000;

const EMPTY_STATE = Object.freeze({ version: 1, image: null, imageDigest: null, startedAt: null, leases: [], lastUpdate: null });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * True when a task will be driven by Formal AI.
 *
 * Issue #2146 requires the lifecycle to key off the *model*, never the CLI
 * tool: `--tool claude --model formal-ai` is a Formal AI task, and
 * `--tool claude --model opus` is not.
 *
 * @param {object} params
 * @param {string[]} [params.args] - The task's argument vector.
 * @param {string} [params.model] - An already-resolved model, when known.
 * @returns {boolean}
 */
export const isFormalAiTask = ({ args = [], model = null } = {}) => isFormalAiModel(model || getModelFromArgs(args));

/** Build the endpoint origin for a host name or address. */
