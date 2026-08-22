import { spawn } from 'child_process';
import { describeChildExit } from './child-exit.lib.mjs';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { formatFailedLaunchMessage as defaultFormatFailedLaunchMessage } from './work-session-formatting.lib.mjs';

const exec = promisify(execCallback);

let deprecationWarned = false;
function warnStartScreenDeprecated() {
  if (deprecationWarned) return;
  if (process.env.HIVE_MIND_SUPPRESS_DEPRECATIONS === '1') return;
  deprecationWarned = true;
  console.warn('⚠️  executeStartScreen is deprecated; prefer the `--isolated screen` workflow exposed by hive/solve directly. Set HIVE_MIND_SUPPRESS_DEPRECATIONS=1 to silence this warning.');
}

async function findStartScreenCommand() {
  try {
    const { stdout } = await exec('which start-screen');
    return stdout.trim();
  } catch {
    return null;
  }
}

function executeWithCommand(startScreenCmd, command, args, verbose = false) {
  return new Promise(resolve => {
    const allArgs = [command, ...args];

    if (verbose) {
      console.log(`[VERBOSE] Executing: ${startScreenCmd} ${allArgs.join(' ')}`);
    } else {
      console.log(`Executing: ${startScreenCmd} ${allArgs.join(' ')}`);
    }

    const child = spawn(startScreenCmd, allArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    child.on('error', error => {
      resolve({
        success: false,
        output: stdout,
        error: error.message,
      });
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout,
        });
      } else {
        resolve({
          success: false,
          output: stdout,
          // Issue #2135: name the signal, so an out-of-memory abort is not
          // reported as "code null".
          error: stderr || describeChildExit({ command: 'Command', code, signal }),
        });
      }
    });
  });
}

/**
 * Build the executeAndUpdateMessage function used by /solve and /hive in
 * telegram-bot.mjs. The original function captures ~10 module-level closures
 * (resolveIsolation, ISOLATION_BACKEND, isolationRunner, VERBOSE, executeStartScreen,
 * trackSession, AUTO_WATCH_MESSAGE, startAutoTerminalWatchForSession, bot,
 * formatExecutingWorkSessionMessage); the factory pattern lets us extract the
 * function while still keeping all those handles available without making them
 * module-global elsewhere. Splitting this out keeps telegram-bot.mjs under the
 * 1500-line cap (issues #1141, #1730, #594).
 *
 * @param {Object} deps - Dependencies captured at bot startup time.
 * @param {Function} deps.resolveIsolation
 * @param {string|null} deps.ISOLATION_BACKEND
 * @param {Object} deps.isolationRunner
 * @param {boolean} deps.VERBOSE
 * @param {Function} deps.executeStartScreen
 * @param {Function} deps.trackSession
 * @param {boolean} deps.AUTO_WATCH_MESSAGE
 * @param {Function} deps.startAutoTerminalWatchForSession
 * @param {Object} deps.bot
 * @param {Function} deps.formatExecutingWorkSessionMessage
 * @returns {Function} executeAndUpdateMessage(ctx, startingMessage, commandName, args, infoBlock, perCommandIsolation, tool, urlContext, sessionExtras)
 */
export function buildExecuteAndUpdateMessage(deps) {
  const { resolveIsolation, ISOLATION_BACKEND, isolationRunner, VERBOSE, executeStartScreen, trackSession, untrackSession, AUTO_WATCH_MESSAGE, startAutoTerminalWatchForSession, bot, formatExecutingWorkSessionMessage, formatStartingWorkSessionMessage, formatFailedLaunchMessage = defaultFormatFailedLaunchMessage } = deps;
  return async function executeAndUpdateMessage(ctx, startingMessage, commandName, args, infoBlock, perCommandIsolation = null, tool = 'claude', urlContext = null, { showLimits = false, limitsAtStart = null, locale = null, commandAlias = null } = {}) {
    const { chat, message_id: msgId } = startingMessage;
    const safeEdit = async text => {
      try {
        await ctx.telegram.editMessageText(chat.id, msgId, undefined, text, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error(`[telegram-bot] Failed to update message for ${commandName}: ${e.message}`);
      }
    };
    const requesterUserId = ctx.from?.id ?? null; // Issue #1688: suppress duplicate /subscribe DM
    // #1927 review follow-up: persist the full args so a killed /solve can be
    //   resumed with its exact original invocation + `--resume <lastSessionId>`.
    const baseSessionInfo = { chatId: ctx.chat.id, messageId: msgId, startTime: new Date(), url: args[0], command: commandName, commandAlias, tool, infoBlock, urlContext, requesterUserId, showLimits, limitsAtStart, locale, args: Array.isArray(args) ? [...args] : undefined }; // #594: showLimits/limitsAtStart
    const iso = await resolveIsolation(perCommandIsolation, ISOLATION_BACKEND, isolationRunner, VERBOSE);
    let result, session, sessionInfo;
    if (iso) {
      // Issue #1946: the isolation session UUID is generated locally, *before*
      // start-command launches the (potentially multi-GB, slow) container. Show
      // the UUID + isolation backend and track the session immediately so it is
      // addressable by /watch, /log and /status during the whole startup window
      // instead of only after the blocking launch returns. start-command runs the
      // container detached, so the await below does not block other bot commands.
      session = iso.runner.generateSessionId();
      VERBOSE && console.log(`[VERBOSE] Using isolation (${iso.backend}), session: ${session}`);
      sessionInfo = { ...baseSessionInfo, isolationBackend: iso.backend, sessionId: session };
      trackSession(session, sessionInfo, VERBOSE);
      await safeEdit(formatStartingWorkSessionMessage({ sessionName: session, isolationBackend: iso.backend, infoBlock, locale }));
      result = await iso.runner.executeWithIsolation(commandName, args, { backend: iso.backend, sessionId: session, tool, verbose: VERBOSE });
      if (result.success && sessionInfo && (Number.isFinite(result.containerFilesystemStartBytes) || result.executionUuid)) {
        if (Number.isFinite(result.containerFilesystemStartBytes)) sessionInfo.containerFilesystemStartBytes = result.containerFilesystemStartBytes;
        // Issue #2154: `$ --list` identifies executions by start-command's own
        // UUID, not by the session name the bot shows. Keep both on the session
        // so the two views can be joined — in the reply, in the structured log
        // and in the durable snapshot after a restart.
        if (result.executionUuid) sessionInfo.executionUuid = result.executionUuid;
        trackSession(session, sessionInfo, VERBOSE);
      }
      if (!result.success) {
        // The launch never produced a live container — drop the optimistic
        // tracking so a phantom session is not monitored or resumed.
        // Issue #2154: the untracking used to be the *only* trace of the
        // failure anywhere outside Telegram. Record the UUID, the backend and
        // the reason first, so the bot log explains why a session that was
        // announced a second ago is gone and absent from `--list`.
        const launchError = result.error || result.output || 'unknown error';
        console.error(`[telegram-bot] ${commandName} session ${session} was not launched (isolation=${iso.backend}, tool=${tool}): ${launchError}`);
        // The reason also goes into the structured `session_untracked` event, so
        // the timestamped log explains the disappearance on its own.
        if (typeof untrackSession === 'function') untrackSession(session, VERBOSE, { reason: launchError });
        sessionInfo = undefined;
      }
    } else {
      result = await executeStartScreen(commandName, args);
      const match = result.success && (result.output.match(/session:\s*(\S+)/i) || result.output.match(/screen -R\s+(\S+)/));
      session = match ? match[1] : 'unknown';
      // Issue #1586: Non-isolation sessions auto-expire after 10 min — screen stays alive via `exec bash` so completion can't be detected reliably; this still blocks duplicate commands in the timeout window.
      if (result.success && session !== 'unknown') {
        sessionInfo = baseSessionInfo;
        trackSession(session, sessionInfo, VERBOSE);
      }
    }
    if (result.warning) return safeEdit(`⚠️  ${result.warning}`);
    if (result.success) {
      await safeEdit(formatExecutingWorkSessionMessage({ sessionName: session, executionUuid: result.executionUuid || null, isolationBackend: iso?.backend || null, infoBlock, locale }));
      if (AUTO_WATCH_MESSAGE && commandName === 'solve' && sessionInfo?.isolationBackend) await startAutoTerminalWatchForSession({ bot, ctx, sessionId: session, sessionInfo, verbose: VERBOSE });
    } else {
      // Issue #2154: keep the session UUID in the failure reply. It is the only
      // handle the operator has on the attempt, and this edit replaces the
      // "🔄 Starting..." message that used to carry it.
      if (!iso) console.error(`[telegram-bot] ${commandName} command failed to start (no isolation, tool=${tool}): ${result.error || result.output || 'unknown error'}`);
      await safeEdit(formatFailedLaunchMessage({ commandName, sessionName: iso ? session : null, isolationBackend: iso?.backend || null, infoBlock, error: result.error || result.output, locale }));
    }
  };
}

export async function executeStartScreen(command, args, options = {}) {
  const { verbose = false } = options;

  warnStartScreenDeprecated();

  try {
    const whichPath = await findStartScreenCommand();

    if (!whichPath) {
      const warningMsg = '⚠️  WARNING: start-screen command not found in PATH\n' + 'Please ensure @link-assistant/hive-mind is properly installed\n' + 'You may need to run: npm install -g @link-assistant/hive-mind';
      console.warn(warningMsg);

      return {
        success: false,
        warning: warningMsg,
        error: 'start-screen command not found in PATH',
      };
    }

    if (verbose) {
      console.log(`[VERBOSE] Found start-screen at: ${whichPath}`);
    }

    return await executeWithCommand(whichPath, command, args, verbose);
  } catch (error) {
    console.error('Error executing start-screen:', error);
    return {
      success: false,
      output: '',
      error: error.message,
    };
  }
}
