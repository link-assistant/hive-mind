#!/usr/bin/env node

/**
 * The PR comment posted when a stalled Claude stream is force-killed and retried
 * (issue #1510).
 *
 * Issue #2492: it said "Session will be resumed with `--resume` (context
 * preserved)" even when no session id was known, so the retry actually started
 * from scratch, and ended with a footer that repeated the line above it. The
 * text now follows the `resume` decision the caller already made.
 */

import { SESSION_FORCE_KILLED_MARKER } from './tool-comments.lib.mjs';

/**
 * @param {Object} params
 * @param {'activity'|'startup'} params.timeoutType which stream timeout fired
 * @param {number} params.silentSeconds how long the stream produced no output
 * @param {number} params.attempt the retry about to run (1-based)
 * @param {string} params.delayLabel human-readable wait before the retry
 * @param {string|null} params.resumeSessionId session the retry resumes, or null for a fresh start
 * @returns {string} Markdown comment body
 */
export const buildSessionForceKilledComment = ({ timeoutType, silentSeconds, attempt, delayLabel, resumeSessionId = null }) => {
  const how = resumeSessionId ? `resuming session \`${resumeSessionId}\` (previous context kept)` : 'starting fresh (no session to resume)';
  return `## :warning: ${SESSION_FORCE_KILLED_MARKER} (${timeoutType} timeout)\n\nNo output for ${silentSeconds}s, so the session was stopped. Retry ${attempt} in ${delayLabel}, ${how}.`;
};

export default { buildSessionForceKilledComment };
