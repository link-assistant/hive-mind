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
 * @param {boolean} [options.resumed] - A new working session was started
 * @param {string|null} [options.recoverySessionId] - Id of that working session
 * @param {string|null} [options.resumeCommand] - Command to resume manually
 * @param {number|null} [options.attempt] - Resume attempt number
 * @param {number|null} [options.maxAttempts]
 * @param {boolean} [options.attachLogs] - Whether --attach-logs is enabled
 * @param {string|null} [options.logUrl] - URL of the uploaded intermediate log
 * @returns {string} Markdown body
 */
export function buildKillRecoveryNotice({ diagnosis = null, exitCode = null, sessionName = null, observedAt = null, policy = null, resumed = false, recoverySessionId = null, resumeCommand = null, attempt = null, maxAttempts = null, attachLogs = false, logAttached = false, logUrl = null } = {}) {
  const cause = diagnosis?.cause || null;
  const title = resumed ? `⚠️ Working session ${killRecoveryHeadline(cause)}` : `❌ ${CAUSE_TITLES[cause] || 'Working session was killed'}`;

  const lines = [KILL_RECOVERY_NOTICE_MARKER, `## ${title}`, ''];

  if (diagnosis?.summary) lines.push(diagnosis.summary, '');

  const facts = [];
  if (exitCode !== null && exitCode !== undefined) facts.push(`- **Exit code:** ${exitCode}`);
  if (observedAt) facts.push(`- **Detected at:** ${observedAt}`);
  if (sessionName) facts.push(`- **Working session:** \`${sessionName}\``);
  if (policy) facts.push(`- **On-kill policy:** \`${policy}\`${policy === ON_SESSION_KILL_RESUME ? ' (`--on-session-kill=resume`)' : ' (`--on-session-kill=report`)'}`);
  if (facts.length > 0) lines.push(...facts, '');

  const evidence = Array.isArray(diagnosis?.evidence) ? diagnosis.evidence.filter(Boolean) : [];
  if (evidence.length > 0) {
    lines.push('<details><summary>Kill diagnostics</summary>', '');
    for (const item of evidence) lines.push(`- ${item}`);
    lines.push('', '</details>', '');
  }

  if (resumed) {
    const attemptSuffix = attempt && maxAttempts ? ` (attempt ${attempt}/${maxAttempts})` : '';
    const sessionSuffix = recoverySessionId ? ` Its working session is \`${recoverySessionId}\`.` : '';
    lines.push(`🔄 A **new working session was started** to recover from this event${attemptSuffix}. Progress below continues in that session.${sessionSuffix}`, '');
  } else {
    lines.push('This working session did not continue. Nothing below this comment was produced by it.', '');
  }

  if (logUrl) {
    lines.push(`📎 Intermediate working-session log: ${logUrl}`, '');
  } else if (logAttached) {
    lines.push('📎 The intermediate working-session log was uploaded as a separate comment.', '');
  } else if (!attachLogs) {
    lines.push('_The intermediate working-session log was not uploaded because `--attach-logs` is disabled._', '');
  }

  if (resumeCommand) {
    lines.push('To continue manually:', '', '```bash', resumeCommand, '```', '');
  }

  lines.push(`<sub>Reported by Hive Mind — [issue #2134](https://github.com/link-assistant/hive-mind/issues/2134)</sub>`);
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
    child.on('close', code => resolve({ code, stdout, stderr }));
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
export async function postKillRecoveryNotice({ pullRequestUrl, body, runCommand = spawnCapture, tempDir = '/tmp', fileSuffix = 'notice', writeFile = defaultWriteFile, unlink = defaultUnlink, verbose = false }) {
  if (!pullRequestUrl) return { posted: false, url: null, error: 'no pull request url' };
  if (typeof runCommand !== 'function') return { posted: false, url: null, error: 'no command runner' };

  const bodyFile = `${tempDir.replace(/\/$/, '')}/hive-mind-kill-notice-${fileSuffix}.md`;
  try {
    await writeFile(bodyFile, body);
    const result = await runCommand('gh', ['pr', 'comment', pullRequestUrl, '--body-file', bodyFile]);
    if (result?.code === 0) {
      const url = String(result.stdout || '').trim() || null;
      if (verbose) console.log(`[VERBOSE] Posted killed-session notice to ${pullRequestUrl}${url ? ` (${url})` : ''}`);
      return { posted: true, url, error: null };
    }
    const error = String(result?.stderr || result?.stdout || `gh pr comment exited with code ${result?.code}`).trim();
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
