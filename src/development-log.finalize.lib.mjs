/**
 * Build a per-session finalizer so every completion path can preserve a
 * development log without creating duplicate commits.
 *
 * Issue #1596 introduced a once-only finalizer: the first call collected the
 * artifacts and every later call reused the memoized promise. Issue #2090
 * showed that this silently drops every session after the first one — a run
 * with `--auto-restart-until-mergeable` starts a brand new tool session (a new
 * session UUID) per restart iteration, but only the very first session ever
 * reached the repository.
 *
 * The finalizer is therefore memoized *per session id* instead of per process:
 *
 * - the same session id is collected only once (no duplicate commits),
 * - a different session id is collected again into its own `sessions/<uuid>/`
 *   directory,
 * - each collection copies only the slice of the solve log that was produced
 *   since the previous collection, so the union of all session directories is
 *   the complete process log without duplicating megabytes per session.
 */
export const createDevelopmentLogFinalizer = ({ collect, getParams, register = true }) => {
  // sessionKey -> promise of the collection result (dedupe per session).
  const collections = new Map();
  // sessionKey -> { startByte, sessionId } of an already collected session.
  const sessionStartBytes = new Map();
  // Byte offset in the solve log right after the last collected slice.
  let nextLogStartByte = 0;
  // Key of the session collected most recently, so a forced finalize at exit
  // extends *that* session's log slice instead of re-collecting the first one.
  let lastSessionKey = null;
  // Serializes collections so their log slices never interleave.
  let queue = Promise.resolve();

  const toKey = sessionId => (sessionId ? String(sessionId) : '__no-session__');

  const finalize = (options = {}) => {
    const params = { ...getParams() };
    if (options.sessionId !== undefined && options.sessionId !== null) params.sessionId = options.sessionId;

    let sessionKey = toKey(params.sessionId);
    if (options.force && options.sessionId === undefined && lastSessionKey) {
      // Exit-time collection: the log tail belongs to the session collected
      // most recently (which is a restart-iteration session, not the first one
      // still referenced by the caller's `sessionId` variable).
      sessionKey = lastSessionKey;
      params.sessionId = sessionStartBytes.get(sessionKey)?.sessionId ?? params.sessionId;
    }
    const alreadyCollected = collections.has(sessionKey);

    // Re-collecting the same session is only useful when the caller explicitly
    // asks for it (process exit, to capture the log tail produced after the
    // session finished). Otherwise reuse the memoized result.
    if (alreadyCollected && !options.force) return collections.get(sessionKey);

    lastSessionKey = sessionKey;

    // Collections are serialized: each one commits and pushes, and the log
    // slice boundaries only make sense when resolved sequentially.
    const resultPromise = queue
      .catch(() => {})
      .then(() => {
        const known = sessionStartBytes.get(sessionKey);
        const logStartByte = known ? known.startByte : nextLogStartByte;
        sessionStartBytes.set(sessionKey, { startByte: logStartByte, sessionId: params.sessionId ?? null });
        return collect({ ...params, logStartByte });
      })
      .then(result => {
        const endByte = result?.logEndByte;
        if (typeof endByte === 'number' && endByte > nextLogStartByte) nextLogStartByte = endByte;
        return result;
      });

    queue = resultPromise.catch(() => {});
    collections.set(sessionKey, resultPromise);
    return resultPromise;
  };

  finalize.getCollectedSessionKeys = () => [...collections.keys()];
  // Publish the finalizer so restart iterations (watch mode,
  // auto-restart-until-mergeable, keep-working, escalation, auto-ensure) and
  // every exit path can collect the session they just finished.
  if (register) setActiveDevelopmentLogFinalizer(finalize);
  return finalize;
};

// Module-level registry so restart iterations deep in the call tree (watch
// mode, auto-restart-until-mergeable, keep-working, escalation, auto-ensure)
// can finalize the development log of the session they just finished without
// threading the finalizer through every call signature.
let activeFinalizer = null;

export const setActiveDevelopmentLogFinalizer = finalizer => {
  activeFinalizer = typeof finalizer === 'function' ? finalizer : null;
};

export const getActiveDevelopmentLogFinalizer = () => activeFinalizer;

export const finalizeActiveDevelopmentLog = async (options = {}) => {
  if (!activeFinalizer) return { skipped: 'no-active-finalizer' };
  try {
    return await activeFinalizer(options);
  } catch (error) {
    return { skipped: 'error', error };
  }
};
