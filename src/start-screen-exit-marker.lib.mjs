/**
 * Exit status markers for plain (non-isolation) start-screen sessions.
 *
 * start-screen keeps its screen alive with `exec bash` after the command ends,
 * so `screen -ls` never reports the work as finished and the session monitor
 * used to expire the session after a fixed 10 minutes with no exit code at all
 * (issue #1586). start-screen now writes the command's exit status to a small
 * file before handing the screen over to the idle shell; the session monitor
 * reads that file to learn when the work really ended and how (issue #3215).
 */
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';

export const SCREEN_EXIT_MARKER_DIR_NAME = 'hive-mind-screen-exit';
export const SCREEN_EXIT_MARKER_OUTPUT_LABEL = 'Exit status file:';

export function getScreenExitMarkerDir({ tmpDir = os.tmpdir() } = {}) {
  return path.join(tmpDir, SCREEN_EXIT_MARKER_DIR_NAME);
}

export function getScreenExitMarkerPath(sessionName, options = {}) {
  const safeName = String(sessionName || 'session').replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(getScreenExitMarkerDir(options), `${safeName}.exit`);
}

/**
 * Shell fragment appended to the screen command. The path is quoted for the
 * outer single-quoted `bash -c '...'` string start-screen builds, so it only
 * ever contains the characters getScreenExitMarkerPath keeps.
 */
export function buildScreenExitMarkerSuffix(markerPath) {
  if (!/^[A-Za-z0-9._/-]+$/.test(markerPath)) throw new Error(`Unsupported exit marker path: ${markerPath}`);
  return `; echo $? > ${markerPath}`;
}

/** Remove a leftover marker and make sure its directory exists. */
export function prepareScreenExitMarker(markerPath, { fsImpl = fs } = {}) {
  fsImpl.mkdirSync(path.dirname(markerPath), { recursive: true }); // hive-sync-ok: start-screen CLI, before the screen starts
  fsImpl.rmSync(markerPath, { force: true }); // hive-sync-ok: start-screen CLI, before the screen starts
}

/** The marker path start-screen printed, or null for an older start-screen. */
export function parseScreenExitMarkerPath(output) {
  const match = String(output || '').match(/Exit status file:\s*(\S+)/);
  return match ? match[1] : null;
}

/** The recorded exit status, or null while the command is still running. */
export async function readScreenExitMarker(markerPath, { readFile = fsPromises.readFile } = {}) {
  if (!markerPath) return null;
  let raw;
  try {
    raw = await readFile(markerPath, 'utf8');
  } catch {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export async function removeScreenExitMarker(markerPath, { rm = fsPromises.rm } = {}) {
  if (!markerPath) return;
  try {
    await rm(markerPath, { force: true });
  } catch {
    // Best effort: a leftover marker is removed again before the next launch.
  }
}

/**
 * Issue #1586: how long a screen session without an exit status file (one
 * started by an older start-screen) is tracked. Expiring it prevents false
 * positives that would block the URL forever, while still preventing
 * accidental duplicate commands inside the window.
 */
export const NON_ISOLATION_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
/**
 * Issue #3215: a session whose start-screen records its exit status is tracked
 * until that status appears (or the screen disappears); this cap only bounds
 * how long a lost status file can block duplicate commands for the same URL.
 */
export const NON_ISOLATION_MARKED_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Where a plain screen session stands: finished with a recorded exit status,
 * expired (no longer tracked, outcome unknown) or still within its window.
 * Synchronous: it uses the status the monitor last read into
 * `sessionInfo.recordedExitCode` (see readScreenExitMarker).
 */
export function getNonIsolationSessionProgress(sessionInfo, { now = Date.now() } = {}) {
  const startTime = sessionInfo?.startTime instanceof Date ? sessionInfo.startTime : new Date(sessionInfo?.startTime);
  const elapsedMs = now - startTime.getTime();
  const timeoutMs = sessionInfo?.exitMarkerPath ? NON_ISOLATION_MARKED_SESSION_TIMEOUT_MS : NON_ISOLATION_SESSION_TIMEOUT_MS;
  const exitCode = Number.isInteger(sessionInfo?.recordedExitCode) ? sessionInfo.recordedExitCode : null;
  return { finished: exitCode !== null, exitCode, expired: exitCode === null && elapsedMs >= timeoutMs, elapsedMs, timeoutMs };
}
