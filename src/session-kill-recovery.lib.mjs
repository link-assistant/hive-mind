/**
 * Pull-request side of killed-session handling (issue #2134).
 *
 * The issue's screenshot showed the two surfaces disagreeing: Telegram announced
 * "Work session killed — out of memory or forced kill (SIGKILL) (exit code: 137)"
 * while the pull request silently carried on, with nothing to tell a reader that
 * a kill had happened at all — let alone that a new working session had been
 * started to recover from it.
 *
 * This module makes the pull request say exactly what the bot says:
 *
 *   - `buildKillRecoveryNotice()` renders the Markdown notice (kill cause,
 *     diagnostics evidence, what happens next, resume command).
 *   - `postKillRecoveryNotice()` posts it with `gh pr comment --body-file`.
 *   - `attachIntermediateSessionLog()` uploads the intermediate working-session
 *     log — ONLY when `--attach-logs` is enabled, per the issue: "Logs are
 *     uploaded as usual only if --attach-logs is enabled."
 *
 * Every external dependency is injectable so the builders can be unit-tested
 * without touching GitHub.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2134
 */

import { spawn } from 'child_process';
import { describeChildExit } from './child-exit.lib.mjs';
import { sanitizeForPublication } from './token-sanitization.lib.mjs'; // issue #2156: this body is published to a pull request
import { KILL_CAUSE_DISK_FULL, KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY } from './session-kill-diagnostics.lib.mjs';
import { ON_SESSION_KILL_RESUME } from './session-kill-policy.lib.mjs';

/** Marker used to recognise (and avoid duplicating) our own notices. */
export const KILL_RECOVERY_NOTICE_MARKER = '<!-- hive-mind:session-kill-notice -->';

const CAUSE_HEADLINES = {
  [KILL_CAUSE_OUT_OF_MEMORY]: 'recovered from out of memory',
  [KILL_CAUSE_FORCED_KILL]: 'recovered from forced kill',
  [KILL_CAUSE_DISK_FULL]: 'recovered from disk exhaustion',
};

const CAUSE_TITLES = {
  [KILL_CAUSE_OUT_OF_MEMORY]: 'Working session was killed: out of memory',
  [KILL_CAUSE_DISK_FULL]: 'Working session was killed: disk full',
  [KILL_CAUSE_FORCED_KILL]: 'Working session was force-killed',
};

/**
 * Human-readable headline for a recovered session, matching the wording the
 * issue asks the Telegram bot to use.
 *
 * @param {string} cause - One of the KILL_CAUSE_* constants
 * @returns {string}
 */
export function killRecoveryHeadline(cause) {
  return CAUSE_HEADLINES[cause] || 'recovered from an unexpected kill';
}

/**
 * Render the pull-request notice for a killed (and possibly resumed) session.
 *
 * @param {Object} options
 * @param {Object} [options.diagnosis] - Result of describeKillCause()
 * @param {number|null} [options.exitCode]
 * @param {string} [options.sessionName]
 * @param {string|null} [options.observedAt] - ISO timestamp of the kill/OOM event
 * @param {string} [options.policy] - Resolved --on-session-kill policy
 * @param {boolean} [options.resumed] - A new working session was actually started
 * @param {boolean} [options.survived] - The work session completed after a child OOM event
 * @param {boolean} [options.oomEventOnly] - A child OOM event preceded an ordinary work failure
 * @param {{reason: string, line: string}|null} [options.deliberateStop] - solve's own stop verdict (issue #2408)
 * @param {string|null} [options.recoverySessionId] - Id of that working session
 * @param {string|{shell?: string, display?: string}|null} [options.resumeCommand] - Shell command to resume manually
 * @param {number|null} [options.attempt] - Resume attempt number
 * @param {number|null} [options.maxAttempts]
 * @param {boolean} [options.attachLogs] - Whether --attach-logs is enabled
 * @param {string|null} [options.logUrl] - URL of the uploaded intermediate log
 * @returns {string} Markdown body
 */
export function buildKillRecoveryNotice({ diagnosis = null, exitCode = null, sessionName = null, observedAt = null, policy = null, resumed = false, survived = false, oomEventOnly = false, deliberateStop = null, recoverySessionId = null, resumeCommand = null, attempt = null, maxAttempts = null, attachLogs = false, logAttached = false, logUrl = null } = {}) {
  const cause = diagnosis?.cause || null;
  // Issue #2498: when solve stopped on its own (e.g. expired authentication),
  // the OOM event did not end the run — lead with the real reason instead of
  // a headline that reads as an OOM failure.
  const stopLine = !resumed && !survived && deliberateStop?.line ? String(deliberateStop.line).replace(/^(?:\[[^\]]*\] )*/, '') : null;
  let title;
  if (stopLine && oomEventOnly) title = 'ℹ️ Work session stopped on its own — the earlier container OOM event did not cause it';
  else if (stopLine) title = '⚠️ Working session was killed after solve had already stopped on its own';
  else if (oomEventOnly) title = resumed ? '⚠️ Work session restarted after a failed run with a container OOM event' : '⚠️ Container OOM event during a failed work session';
  else if (resumed) title = '⚠️ Working session restarted after a kill — outcome pending';
  // Issue #2498 (package-registry-manager#31): a session that exited 0 was
  // never killed or restarted, so "recovered from out of memory" read as if a
  // recovery had happened. Say what did happen instead.
  else if (survived && cause === KILL_CAUSE_OUT_OF_MEMORY) title = 'ℹ️ Work session completed — an earlier container OOM event did not stop it';
  else title = survived ? `⚠️ Working session ${killRecoveryHeadline(cause)}` : `❌ ${CAUSE_TITLES[cause] || 'Working session was killed'}`;

  const lines = [KILL_RECOVERY_NOTICE_MARKER, `## ${title}`, ''];

  if (stopLine) lines.push('**Why the work session stopped** (from its log):', '', `> ${stopLine}`, '');
  if (diagnosis?.summary) lines.push(stopLine && oomEventOnly ? `Earlier event (not the cause of this stop): ${diagnosis.summary}` : diagnosis.summary, '');

  const facts = [];
  if (exitCode !== null && exitCode !== undefined) facts.push(`- **Exit code:** ${exitCode}`);
  if (observedAt) facts.push(oomEventOnly || survived ? `- **OOM event observed at:** ${observedAt}` : `- **Detected at:** ${observedAt}`);
  if (sessionName) facts.push(`- **Working session:** \`${sessionName}\``);
  if (policy) facts.push(`- **On-kill policy:** \`${policy}\`${policy === ON_SESSION_KILL_RESUME ? ' (`--on-session-kill=resume`)' : ' (`--on-session-kill=report`)'}`);
  if (facts.length > 0) lines.push(...facts, '');

  const evidence = Array.isArray(diagnosis?.evidence) ? diagnosis.evidence.filter(Boolean) : [];
  if (evidence.length > 0) {
    lines.push(`<details><summary>${stopLine && oomEventOnly ? 'OOM event diagnostics' : 'Kill diagnostics'}</summary>`, '');
    for (const item of evidence) lines.push(`- ${item}`);
    lines.push('', '</details>', '');
  }

  if (resumed) {
    const attemptSuffix = attempt && maxAttempts ? ` (attempt ${attempt}/${maxAttempts})` : '';
    const sessionSuffix = recoverySessionId ? ` Its working session is \`${recoverySessionId}\`.` : '';
    lines.push(`🔄 A **new working session was started** to recover from this event${attemptSuffix}. The launch was accepted; activity and the final outcome are not yet confirmed.${sessionSuffix}`, '');
  } else if (stopLine && oomEventOnly) {
    lines.push('A child process was OOM-killed earlier, but the work process kept running and later stopped for the reason above. No replacement session was launched.', '');
  } else if (stopLine) {
    lines.push('solve had already stopped for the reason above before the process was killed. No replacement session was launched.', '');
  } else if (survived) {
    lines.push('The work session survived the container OOM event and completed. No recovery was needed and no replacement session was launched.', '');
  } else if (oomEventOnly) {
    lines.push('The work process survived the container OOM event but later exited with a failure. No replacement session was launched.', '');
  } else {
    lines.push('This working session did not continue. Nothing below this comment was produced by it.', '');
  }

  if (logUrl) {
    lines.push(`📎 Intermediate working-session log: ${logUrl}`, '');
  } else if (logAttached) {
    lines.push('📎 The intermediate working-session log was uploaded as a separate comment.', '');
  } else if (!attachLogs && !survived) {
    lines.push('_The intermediate working-session log was not uploaded because `--attach-logs` is disabled._', '');
  }

  // Issue #2408: callers hold buildResumeCommand()'s `{ binary, args, display, shell }`
  // object, which a template rendered as "[object Object]". Issue #2887: this
  // is a `bash` block, so prefer the runnable `shell` form over the Telegram
  // alias in `display` (`/codex …` is not a program).
  const manualCommand = typeof resumeCommand === 'string' ? resumeCommand : resumeCommand?.shell || resumeCommand?.display || null;
  if (manualCommand) {
    lines.push('To continue manually:', '', '```bash', manualCommand, '```', '');
  }

  lines.push(`<sub>Reported by Hive Mind</sub>`);
  return lines.join('\n');
}

/**
 * Run a command and capture its output, without a shell (the notice body never
 * touches the command line — it is passed via `--body-file`).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {Object} [options] - Forwarded to child_process.spawn
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function spawnCapture(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', error => resolve({ code: 1, stdout, stderr: stderr || error.message }));
    // Issue #2135: keep the signal. `close` reports `code === null` for a
    // signalled child, and interpolating that null is how "exited with code
    // null" reached a user notification with no cause attached.
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

const defaultWriteFile = async (filePath, content) => {
  const fs = (await import('fs')).promises;
  await fs.writeFile(filePath, content, 'utf8');
};

const defaultUnlink = async filePath => {
  const fs = (await import('fs')).promises;
  await fs.unlink(filePath).catch(() => {});
};

/**
 * Post the notice to a pull request via `gh pr comment --body-file`.
 *
 * `--body-file` (not `--body`) is used deliberately: the notice contains
 * backticks and newlines that would otherwise have to survive shell quoting.
 *
 * Issue #2156: the body is sanitized here rather than by the caller. It carries
 * kill diagnostics and a resume command, both assembled from process and log
 * data, so it is a publication boundary like any other and must fail closed.
 * The array-argument `gh` invocation below is invisible to the
 * `require-sanitized-output` ESLint rule, which is exactly how this path stayed
 * unsanitized; the rule now understands this shape too.
 *
 * @param {Object} options
 * @param {string} options.pullRequestUrl
 * @param {string} options.body
 * @param {Function} options.runCommand - async (cmd, args) => { code, stdout, stderr }
 * @param {string} [options.tempDir=/tmp]
 * @param {string} [options.fileSuffix] - Deterministic suffix for the temp file
 * @param {Function} [options.writeFile]
 * @param {Function} [options.unlink]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{posted: boolean, url: string|null, error: string|null}>}
 */
export async function postKillRecoveryNotice({ pullRequestUrl, commentUrl = null, body, runCommand = spawnCapture, tempDir = '/tmp', fileSuffix = 'notice', writeFile = defaultWriteFile, unlink = defaultUnlink, verbose = false }) {
  if (!pullRequestUrl) return { posted: false, url: null, error: 'no pull request url' };
  if (typeof runCommand !== 'function') return { posted: false, url: null, error: 'no command runner' };

  const bodyFile = `${tempDir.replace(/\/$/, '')}/hive-mind-kill-notice-${fileSuffix}.md`;
  try {
    const comment = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)#issuecomment-(\d+)$/.exec(commentUrl || '');
    const target = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(pullRequestUrl);
    const canEdit = comment && target && comment[1] === target[1] && comment[2] === target[2] && comment[3] === target[3];
    const sanitizedBody = await sanitizeForPublication(body);
    await writeFile(bodyFile, canEdit ? JSON.stringify({ body: sanitizedBody }) : sanitizedBody);
    const result = await runCommand('gh', canEdit ? ['api', `repos/${comment[1]}/${comment[2]}/issues/comments/${comment[4]}`, '--method', 'PATCH', '--input', bodyFile, '--jq', '.html_url'] : ['pr', 'comment', pullRequestUrl, '--body-file', bodyFile]);
    if (result?.code === 0) {
      const url = String(result.stdout?.toString() || '').trim() || null;
      if (verbose) console.log(`[VERBOSE] Posted killed-session notice to ${pullRequestUrl}${url ? ` (${url})` : ''}`);
      return { posted: true, url, error: null };
    }
    const error = String(result?.stderr?.toString() || result?.stdout?.toString() || describeChildExit({ command: 'gh pr comment', code: result?.code, signal: result?.signal })).trim();
    if (verbose) console.log(`[VERBOSE] Failed to post killed-session notice: ${error}`);
    return { posted: false, url: null, error };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Failed to post killed-session notice: ${error?.message || error}`);
    return { posted: false, url: null, error: error?.message || String(error) };
  } finally {
    await unlink(bodyFile);
  }
}

/**
 * Upload the intermediate working-session log to the pull request.
 *
 * Per the issue, this is gated on `--attach-logs` exactly like every other log
 * upload — a killed session never becomes a reason to publish logs the user did
 * not ask for.
 *
 * @param {Object} options
 * @param {boolean} options.attachLogs - Resolved `--attach-logs` value
 * @param {string|null} options.logPath
 * @param {string|null} options.pullRequestUrl
 * @param {Function} options.attachLog - attachLogToGitHub-compatible uploader
 * @param {Object} [options.attachOptions] - Extra options forwarded to the uploader
 * @param {string} [options.customTitle]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{uploaded: boolean, skipped: string|null}>}
 */
export async function attachIntermediateSessionLog({ attachLogs, logPath, pullRequestUrl, attachLog, attachOptions = {}, customTitle = '📎 Intermediate working-session log (killed session)', verbose = false }) {
  if (!attachLogs) {
    if (verbose) console.log('[VERBOSE] Skipping intermediate log upload: --attach-logs is disabled');
    return { uploaded: false, skipped: 'attach-logs-disabled' };
  }
  if (!logPath) return { uploaded: false, skipped: 'no-log-path' };
  if (!pullRequestUrl) return { uploaded: false, skipped: 'no-pull-request' };
  if (typeof attachLog !== 'function') return { uploaded: false, skipped: 'no-uploader' };

  const parsed = parsePullRequestUrl(pullRequestUrl);
  if (!parsed) return { uploaded: false, skipped: 'unparsable-pull-request-url' };

  try {
    const ok = await attachLog({
      ...attachOptions,
      logFile: logPath,
      targetType: 'pr',
      targetNumber: parsed.number,
      owner: parsed.owner,
      repo: parsed.repo,
      customTitle,
      verbose,
    });
    return { uploaded: ok !== false, skipped: null };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Intermediate log upload failed: ${error?.message || error}`);
    return { uploaded: false, skipped: `error: ${error?.message || error}` };
  }
}

/**
 * Minimal `https://github.com/<owner>/<repo>/pull/<number>` parser.
 *
 * @param {string} url
 * @returns {{owner: string, repo: string, number: number}|null}
 */
export function parsePullRequestUrl(url) {
  const match = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/u.exec(String(url || ''));
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
