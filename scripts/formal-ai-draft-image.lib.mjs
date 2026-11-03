/**
 * Which hive-mind image a Formal AI draft runs, and pulling it reliably.
 *
 * `docker run konard/hive-mind:latest` used to pull implicitly, once. A Docker
 * Hub timeout (`context deadline exceeded`) then failed the draft before solve
 * started, and `:latest` meant the container could run a different hive-mind
 * than the scripts checked out next to it. The image is now the tag of the
 * checked-out `package.json` version, pulled explicitly with retries.
 *
 * There is no fallback (issue #3909). A tag that is not published yet — a
 * version bumped on `main` before its release finished — used to fall back to
 * `:latest`, which silently ran an older Hive Mind (and its baked Formal AI)
 * than the attempt selected. A missing exact image is now a
 * {@link DraftImageUnavailableError}, which the runner reports as a deferred
 * infrastructure outcome; a registry timeout fails the same way after its
 * retries.
 *
 * @module formal-ai-draft-image
 */

export const HIVE_MIND_IMAGE_REPOSITORY = 'konard/hive-mind';

/** Waits between pull attempts: 15 s, 30 s, 1 min, 2 min. */
export const PULL_RETRY_DELAYS_MS = Object.freeze([15_000, 30_000, 60_000, 120_000]);

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The exact image an attempt selected cannot be obtained; `missing` when the registry says it does not exist. */
export class DraftImageUnavailableError extends Error {
  constructor(message, { missing = true, image = null } = {}) {
    super(message);
    this.name = 'DraftImageUnavailableError';
    this.missing = missing;
    this.image = image;
  }
}

/**
 * The image to run. `fallback` is always null and kept only so existing callers
 * (Formal AI's issue workflow reads `.image`) keep their shape.
 *
 * @param {object} params
 * @param {string} [params.override] an explicit image (workflow input or `vars.FORMAL_AI_DRAFT_IMAGE`), used as given
 * @param {string} [params.version] the checked-out `package.json` version
 * @returns {{image: string, fallback: null}}
 * @throws {Error} when neither an override nor a release version names an exact image
 */
export function resolveDraftImages({ override, version } = {}) {
  const explicit = String(override || '').trim();
  if (explicit) return { image: explicit, fallback: null };
  const pinned = String(version || '').trim();
  if (!SEMVER.test(pinned)) throw new DraftImageUnavailableError(`no exact hive-mind image: the checked-out version ${JSON.stringify(pinned)} is not a release version, and an attempt never runs ${HIVE_MIND_IMAGE_REPOSITORY}:latest`);
  return { image: `${HIVE_MIND_IMAGE_REPOSITORY}:${pinned}`, fallback: null };
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
 * Pull the exact image a draft runs and return its name. Never substitutes
 * another image.
 *
 * @param {object} params
 * @param {string} [params.image] the exact image, when already resolved (the attempt identity's)
 * @param {string} [params.override]
 * @param {string} [params.version]
 * @param {(args: string[]) => Promise<{code: number, output: string}>} params.run
 * @param {(ms: number) => Promise<void>} params.sleep
 * @param {number[]} [params.delays]
 * @param {(message: string) => void} [params.log]
 * @returns {Promise<string>} the image that was pulled
 * @throws {DraftImageUnavailableError}
 */
export async function pullDraftImage({ image: exact, override, version, run, sleep, delays = PULL_RETRY_DELAYS_MS, log = console.log }) {
  const image = String(exact || '').trim() || resolveDraftImages({ override, version }).image;
  const pulled = await pullImageWithRetry({ image, run, sleep, delays, log });
  if (pulled.ok) return image;
  const reason = pulled.missing ? `${image} is not published` : `Could not pull ${image} after ${pulled.attempts} attempt${pulled.attempts === 1 ? '' : 's'}: ${pulled.error}`;
  throw new DraftImageUnavailableError(`${reason}; the attempt is deferred rather than run on another image (issue #3909)`, { missing: pulled.missing, image });
}
