/**
 * Publish orchestration helpers that keep the two failure domains separate:
 *
 * - the publish command itself failing (retryable: run `changeset publish` again)
 * - post-publish verification missing because the npm registry has not
 *   propagated yet (NOT retryable by republishing: the only correct response is
 *   to look again)
 *
 * A single verification check a couple of seconds after a successful publish
 * samples a race: when it misses, republishing fails with "cannot publish over
 * the previously published versions" and a successful release is reported as a
 * failure.
 */

export const DEFAULT_VERIFY_ATTEMPTS = 7;
export const DEFAULT_VERIFY_INITIAL_DELAY = 2000;
export const DEFAULT_VERIFY_MAX_DELAY = 30000;

/**
 * Default sleep implementation.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Patterns that mean "this exact version is already on the registry".
 * Such an error is a cue to verify, not to fail.
 */
const ALREADY_PUBLISHED_PATTERNS = [
  'epublishconflict',
  'cannot publish over the previously published version',
  'cannot publish over previously published version',
  'you cannot publish over the previously published versions',
  'already published',
];

/**
 * Check whether publish output indicates the version is already published.
 * @param {string} output
 * @returns {boolean}
 */
export function isAlreadyPublishedError(output) {
  const lowerOutput = String(output || '').toLowerCase();
  return ALREADY_PUBLISHED_PATTERNS.some((pattern) =>
    lowerOutput.includes(pattern)
  );
}

/**
 * Poll the registry until the version becomes visible, using exponential
 * backoff. Returns true as soon as the version is found.
 * @param {object} options
 * @param {Function} options.verify - async () => boolean
 * @param {number} [options.attempts]
 * @param {number} [options.initialDelay]
 * @param {number} [options.maxDelay]
 * @param {Function} [options.sleepFn]
 * @param {Function} [options.log]
 * @returns {Promise<boolean>}
 */
export async function waitForVersionOnRegistry({
  verify,
  attempts = DEFAULT_VERIFY_ATTEMPTS,
  initialDelay = DEFAULT_VERIFY_INITIAL_DELAY,
  maxDelay = DEFAULT_VERIFY_MAX_DELAY,
  sleepFn = sleep,
  log = () => {},
}) {
  let delay = initialDelay;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await sleepFn(delay);
    let found = false;
    try {
      found = await verify();
    } catch (error) {
      // A transient registry/network error is indistinguishable from a miss
      // here, so polling continues and the release is not failed at this point.
      log(`Verification attempt ${attempt} errored: ${error.message}`);
    }
    if (found) {
      log(`Verification succeeded on attempt ${attempt}`);
      return true;
    }
    log(
      `Verification attempt ${attempt} of ${attempts}: version not visible yet`
    );
    delay = Math.min(delay * 2, maxDelay);
  }
  return false;
}

/**
 * Decide whether a publish invocation should move on to verification.
 * @param {object} outcome
 * @param {boolean} outcome.success
 * @param {Error} [outcome.error]
 * @param {string} [outcome.output]
 * @param {Function} outcome.log
 * @returns {boolean}
 */
function shouldVerify({ success, error, output, log }) {
  if (success) {
    return true;
  }
  if (!isAlreadyPublishedError(output || error?.message || '')) {
    return false;
  }
  log('Publish reported the version is already published, verifying registry.');
  return true;
}

/**
 * Build the result of the verification stage. A verification miss is terminal:
 * the publish path must not be re-entered, because the package may already be
 * live and republishing would fail with a conflict.
 * @param {boolean} verified
 * @returns {{success: boolean, error: Error|null}}
 */
function verificationOutcome(verified) {
  if (verified) {
    return { success: true, error: null };
  }
  const error = new Error(
    'Package not found on npm after publish; verification polling exhausted'
  );
  error.nonRetryable = true;
  error.verificationFailed = true;
  return { success: false, error };
}

/**
 * Run the publish command with retries, then verify with bounded polling.
 *
 * The publish command is retried only when the publish itself failed. Once a
 * publish reports success (or reports an "already published" conflict), the
 * flow moves to verification and never re-enters the publish path.
 *
 * Verification is still required: a publish that falsely claims success still
 * fails the release.
 *
 * @param {object} options
 * @param {Function} options.publish - async () => ({ success, error, output })
 * @param {Function} options.verify - async () => boolean
 * @param {number} [options.maxRetries]
 * @param {number} [options.retryDelay]
 * @param {Function} [options.sleepFn]
 * @param {Function} [options.log]
 * @param {object} [options.verifyOptions]
 * @returns {Promise<{success: boolean, error: Error|null, publishAttempts: number}>}
 */
export async function publishWithRetry({
  publish,
  verify,
  maxRetries = 3,
  retryDelay = 10000,
  sleepFn = sleep,
  log = () => {},
  verifyOptions = {},
}) {
  let publishAttempts = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`Publish attempt ${attempt} of ${maxRetries}...`);
    publishAttempts++;
    const { success, error, output } = await publish();

    if (shouldVerify({ success, error, output, log })) {
      const verified = await waitForVersionOnRegistry({
        verify,
        sleepFn,
        log,
        ...verifyOptions,
      });
      return { ...verificationOutcome(verified), publishAttempts };
    }

    lastError = error;

    if (error?.nonRetryable) {
      return { success: false, error, publishAttempts };
    }

    if (attempt < maxRetries) {
      log(
        `Publish failed: ${error?.message}, waiting ${retryDelay / 1000}s before retry...`
      );
      await sleepFn(retryDelay);
    }
  }

  return {
    success: false,
    error:
      lastError || new Error(`Failed to publish after ${maxRetries} attempts`),
    publishAttempts,
  };
}
