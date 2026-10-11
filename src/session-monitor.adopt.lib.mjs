/**
 * Adopt running task containers the bot is no longer tracking (#2917).
 *
 * After the 2026-10-09 dockerd OOM the bot reported four `/codex` tasks as
 * finished (`exit 137`) and dropped them from its registry; an operator then
 * resumed each one with `$ --resume`, so four `<uuid>-resume-<n>` containers
 * did real work that nothing watched — no completion message, no kill
 * recovery, and `/limits` said `processing: 0`.
 *
 * Every monitor tick, a running task container that no tracked session
 * accounts for is matched against the durable event log
 * (`sessions-events.jsonl`): the newest `track` event of the same session
 * chain carries its chat, message, URL and arguments. Such a container is
 * re-tracked under that session, so its real end is reported where the task
 * was started. A container with no record (not started by this bot, or its
 * history was rotated away) is left alone: it is still counted — and shown as
 * `untracked` — by the queue, but there is nobody to notify about it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import { collectTrackedSessionIdentities, getRootSessionName, partitionTaskContainers } from './docker-task-containers.lib.mjs';

/**
 * A container must have been running this long before it can be adopted, so
 * a task that is being launched right now — its container is up but its
 * session is tracked only once `$` returns — is never adopted from under the
 * launcher.
 */
export const ORPHAN_ADOPTION_MIN_AGE_MS = 2 * 60 * 1000;

/**
 * Fields that describe the attempt the bot already reported, not the resumed
 * container being adopted.
 */
const STALE_ATTEMPT_FIELDS = ['completionNotifiedAt', 'completionExitCode', 'completionStatus', 'killRecoverySessionId', 'oomEventObservedAt', 'dockerBackendGoneFirstSeenAt', 'dockerTerminalUnverifiedFirstSeenAt', 'containerResourceLimitExceeded', 'recoveryLifecycle', 'stopRequestedByUser', 'stopRequestedBy', 'executionUuid'];

/**
 * Identities of a container's session chain: its own name, the session it was
 * resumed from (root) and the session id it was launched under.
 * @param {object} container
 * @returns {Set<string>}
 */
function containerIdentities(container) {
  return new Set([container.name, container.rootSessionName, container.parentSessionId].filter(Boolean).map(String));
}

/**
 * @param {Set<string>} identities
 * @returns {(sessionName: string, sessionInfo: object) => boolean}
 */
function matchesChain(identities) {
  return (sessionName, sessionInfo) => {
    for (const value of [sessionName, sessionInfo?.sessionId, sessionInfo?.rootSessionName, sessionInfo?.killRecoveryOfSession, sessionInfo?.killRecoverySessionId]) {
      if (value && (identities.has(String(value)) || identities.has(getRootSessionName(value)))) return true;
    }
    return false;
  };
}

/**
 * Build the session info that re-tracks `container` from its last record.
 * @param {object} container
 * @param {{sessionName: string, sessionInfo: object, ts: string|null}} record
 * @param {Date} now
 * @returns {object}
 */
export function buildAdoptedSessionInfo(container, record, now = new Date()) {
  const sessionInfo = { ...record.sessionInfo };
  for (const field of STALE_ATTEMPT_FIELDS) delete sessionInfo[field];
  const previousSessionId = record.sessionInfo.sessionId || record.sessionName;
  return {
    ...sessionInfo,
    isolationBackend: 'docker',
    sessionId: container.name,
    tool: sessionInfo.tool || container.tool || undefined,
    url: sessionInfo.url || container.url || undefined,
    rootSessionName: sessionInfo.rootSessionName || container.rootSessionName || record.sessionName,
    // Only a log footer written by this container belongs to it (see scopeRecoveryFooter).
    attemptStartedAt: container.startedAt || now.toISOString(),
    followedResumeOf: previousSessionId !== container.name ? previousSessionId : sessionInfo.followedResumeOf,
    adopted: true,
    adoptedAt: now.toISOString(),
    adoptedFrom: record.ts || null,
  };
}

/**
 * Create the per-process adopter. Containers already looked up without a
 * record are remembered, so the event log is scanned once per container, not
 * once per tick.
 *
 * @param {object} deps
 * @param {() => Array<[string, object]>} deps.entries - tracked `[sessionName, sessionInfo]` pairs
 * @param {(sessionName: string) => boolean} deps.isTracked
 * @param {(sessionName: string, sessionInfo: object) => void} deps.track
 * @param {() => object|null} deps.getStore - session store (findLatestTrackEvent)
 * @param {(type: string, data: object) => void} [deps.logEvent]
 * @returns {(options?: object) => Promise<{adopted: Array, unmatched: Array, skipped?: string}>}
 */
export function createOrphanAdopter({ entries, isTracked, track, getStore, logEvent = () => {} }) {
  const unmatched = new Set();
  return async function adoptOrphanTaskContainers(options = {}) {
    const { taskContainers = null, verbose = false, now = () => new Date(), minAgeMs = ORPHAN_ADOPTION_MIN_AGE_MS } = options;
    const store = getStore();
    if (!store || typeof store.findLatestTrackEvent !== 'function') return { adopted: [], unmatched: [], skipped: 'no-store' };
    let result;
    try {
      result = taskContainers ? await taskContainers(verbose) : await (await import('./docker-task-containers.lib.mjs')).getRunningTaskContainers(verbose);
    } catch {
      return { adopted: [], unmatched: [], skipped: 'docker-error' };
    }
    if (!result?.available) return { adopted: [], unmatched: [], skipped: 'docker-unavailable' };
    const { untracked } = partitionTaskContainers(result.containers, collectTrackedSessionIdentities(entries()));
    const adopted = [];
    const nowDate = now();
    for (const container of untracked) {
      if (unmatched.has(container.name)) continue;
      const startedMs = container.startedAt ? new Date(container.startedAt).getTime() : NaN;
      if (!Number.isFinite(startedMs) || nowDate.getTime() - startedMs < minAgeMs) continue;
      let record;
      try {
        record = store.findLatestTrackEvent(matchesChain(containerIdentities(container)));
      } catch {
        record = null;
      }
      if (!record) {
        unmatched.add(container.name);
        if (verbose) console.log(`[VERBOSE] Untracked task container ${container.name} (${container.tool || 'unknown tool'}, ${container.url || 'no url'}) has no session record; counting it without adopting (issue #2917)`);
        continue;
      }
      // The record's own key is reused unless a live session holds it.
      const sessionName = isTracked(record.sessionName) ? container.name : record.sessionName;
      const sessionInfo = buildAdoptedSessionInfo(container, record, nowDate);
      track(sessionName, sessionInfo);
      adopted.push({ sessionName, container: container.name, url: sessionInfo.url || null, tool: sessionInfo.tool || null, chatId: sessionInfo.chatId ?? null });
      logEvent('session_adopted', { sessionName, container: container.name, rootSessionName: sessionInfo.rootSessionName, url: sessionInfo.url || null, tool: sessionInfo.tool || null, startedAt: container.startedAt || null, recordTs: record.ts });
      console.log(`♻️  Adopted running task container ${container.name} as session ${sessionName} (${sessionInfo.tool || 'unknown tool'}, ${sessionInfo.url || 'no url'}) — it was resumed outside the bot (issue #2917)`);
    }
    return { adopted, unmatched: [...unmatched] };
  };
}
