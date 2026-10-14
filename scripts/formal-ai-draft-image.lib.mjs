/**
 * Which hive-mind image a Formal AI draft runs, and pulling it reliably.
 *
 * `docker run konard/hive-mind:latest` used to pull implicitly, once. A Docker
 * Hub timeout (`context deadline exceeded`) then failed the draft before solve
 * started, and `:latest` meant the container could run a different hive-mind
 * than the scripts checked out next to it. The image is now the tag of the
 * checked-out `package.json` version, pulled explicitly with retries. A tag
 * that is not published yet (a version bumped on `main` before its release
 * finished) falls back to `:latest` with a warning; a registry timeout does not,
 * because silently switching images would hide the outage.
 *
 * @module formal-ai-draft-image
 */

export const HIVE_MIND_IMAGE_REPOSITORY = 'konard/hive-mind';

/** Waits between pull attempts: 15 s, 30 s, 1 min, 2 min. */
export const PULL_RETRY_DELAYS_MS = Object.freeze([15_000, 30_000, 60_000, 120_000]);

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The image to run, and the image to fall back to when it is not published.
 *
 * @param {object} params
 * @param {string} [params.override] an explicit image (workflow input or `vars.FORMAL_AI_DRAFT_IMAGE`), used as given
 * @param {string} [params.version] the checked-out `package.json` version
 * @returns {{image: string, fallback: (string|null)}}
 */
export function resolveDraftImages({ override, version } = {}) {
  const explicit = String(override || '').trim();
  if (explicit) return { image: explicit, fallback: null };
  const latest = `${HIVE_MIND_IMAGE_REPOSITORY}:latest`;
  const pinned = String(version || '').trim();
  if (!SEMVER.test(pinned)) return { image: latest, fallback: null };
  return { image: `${HIVE_MIND_IMAGE_REPOSITORY}:${pinned}`, fallback: latest };
}

/**
 * `missing` when the registry answered that the image does not exist (retrying
 * cannot help), `transient` for everything else.
 *
 * @param {string} output combined `docker pull` output
 * @returns {'missing'|'transient'}
 */
export function classifyPullFailure(output) {
  return /manifest unknown|not found|pull access denied|repository does not exist/i.test(String(output || '')) ? 'missing' : 'transient';
}

const lastLine = output =>
  String(output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .pop() || 'docker pull failed without output';

/**
 * `docker pull image`, retried after each delay in `delays` on a transient failure.
 *
 * @param {object} params
 * @param {string} params.image
 * @param {(args: string[]) => Promise<{code: number, output: string}>} params.run
 * @param {(ms: number) => Promise<void>} params.sleep
 * @param {number[]} [params.delays]
 * @param {(message: string) => void} [params.log]
 * @returns {Promise<{ok: true, attempts: number} | {ok: false, missing: boolean, attempts: number, error: string}>}
 */
export async function pullImageWithRetry({ image, run, sleep, delays = PULL_RETRY_DELAYS_MS, log = console.log }) {
  for (let attempt = 1; ; attempt++) {
    const { code, output } = await run(['pull', image]);
    if (code === 0) return { ok: true, attempts: attempt };
    const error = lastLine(output);
    if (classifyPullFailure(output) === 'missing') return { ok: false, missing: true, attempts: attempt, error };
    if (attempt > delays.length) return { ok: false, missing: false, attempts: attempt, error };
    const delay = delays[attempt - 1];
    log(`docker pull ${image} failed (${error}); retrying in ${Math.round(delay / 1000)} s (attempt ${attempt + 1} of ${delays.length + 1})`);
    await sleep(delay);
  }
}

/**
 * Pull the image a draft runs and return its name.
 *
 * @param {object} params
 * @param {string} [params.override]
 * @param {string} [params.version]
 * @param {(args: string[]) => Promise<{code: number, output: string}>} params.run
 * @param {(ms: number) => Promise<void>} params.sleep
 * @param {number[]} [params.delays]
 * @param {(message: string) => void} [params.log]
 * @param {(message: string) => void} [params.warn]
 * @returns {Promise<string>} the image that was pulled
 */
export async function pullDraftImage({ override, version, run, sleep, delays = PULL_RETRY_DELAYS_MS, log = console.log, warn = console.warn }) {
  const { image, fallback } = resolveDraftImages({ override, version });
  const pulled = await pullImageWithRetry({ image, run, sleep, delays, log });
  if (pulled.ok) return image;
  if (pulled.missing && fallback) {
    warn(`${image} is not published; running ${fallback} instead, which may be a different hive-mind version than the checked-out scripts.`);
    const latest = await pullImageWithRetry({ image: fallback, run, sleep, delays, log });
    if (latest.ok) return fallback;
    throw new Error(`Could not pull ${fallback} after ${latest.attempts} attempt${latest.attempts === 1 ? '' : 's'}: ${latest.error}`);
  }
  throw new Error(`Could not pull ${image} after ${pulled.attempts} attempt${pulled.attempts === 1 ? '' : 's'}: ${pulled.error}`);
}
