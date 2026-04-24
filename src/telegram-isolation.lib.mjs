/**
 * Per-command isolation support for Telegram bot commands.
 *
 * Extracts --isolation <backend> from user args in /solve and /hive commands,
 * so it can be used for execution isolation (via $ CLI from start-command)
 * instead of being forwarded to solve/hive as an unknown argument.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1534
 * @see https://github.com/link-assistant/hive-mind/pull/390
 */

const VALID_ISOLATION_BACKENDS = ['screen', 'tmux', 'docker'];

/**
 * Extract --isolation <backend> from args array.
 * Returns { backend: string|null, filteredArgs: string[] }.
 * The --isolation flag is a per-command execution option (not a solve/hive option),
 * so it must be stripped before passing args to solve/hive validation and execution.
 */
export function extractIsolationFromArgs(args) {
  const filteredArgs = [];
  let backend = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--isolation' && i + 1 < args.length) {
      backend = args[i + 1].trim().toLowerCase();
      i++; // Skip the value
    } else if (args[i].startsWith('--isolation=')) {
      backend = args[i].substring('--isolation='.length).trim().toLowerCase();
    } else {
      filteredArgs.push(args[i]);
    }
  }
  return { backend, filteredArgs };
}

/**
 * Validate an isolation backend value.
 * @param {string} backend
 * @returns {boolean}
 */
export function isValidPerCommandIsolation(backend) {
  return VALID_ISOLATION_BACKENDS.includes(backend);
}

/**
 * Get the effective isolation backend and runner for a command execution.
 * Per-command isolation takes precedence over bot-level ISOLATION_BACKEND.
 *
 * @param {string|null} perCommandIsolation - Per-command --isolation value from user args
 * @param {string} botIsolationBackend - Bot-level ISOLATION_BACKEND
 * @param {object|null} botIsolationRunner - Bot-level isolation runner module
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<{backend: string, runner: object}|null>}
 */
export async function resolveIsolation(perCommandIsolation, botIsolationBackend, botIsolationRunner, verbose = false) {
  const effectiveBackend = perCommandIsolation || botIsolationBackend;
  if (!effectiveBackend) return null;

  let runner = botIsolationRunner;
  if (!runner) {
    try {
      runner = await import('./isolation-runner.lib.mjs');
      if (verbose) console.log('[VERBOSE] Dynamically imported isolation-runner for per-command isolation');
    } catch (e) {
      console.error(`[telegram-bot] Failed to import isolation-runner: ${e.message}`);
      return null;
    }
  }

  return { backend: effectiveBackend, runner };
}

/**
 * Create a queue execute callback that supports per-command isolation.
 * Falls back to the provided fallback callback when no isolation is active.
 */
export function createIsolationAwareQueueCallback(botIsolationBackend, botIsolationRunner, trackSession, fallbackCallback, verbose) {
  return async item => {
    const iso = await resolveIsolation(item.perCommandIsolation, botIsolationBackend, botIsolationRunner, verbose);
    if (iso) {
      const sid = iso.runner.generateSessionId();
      const r = await iso.runner.executeWithIsolation(item.command || 'solve', item.args, { backend: iso.backend, sessionId: sid, verbose });
      if (r.success) trackSession(sid, { chatId: item.ctx?.chat?.id, messageId: item.messageInfo?.messageId, startTime: new Date(), url: item.url, command: item.command || 'solve', isolationBackend: iso.backend, sessionId: sid, tool: item.tool || 'claude' }, verbose);
      return { ...r, sessionId: sid, isolationBackend: iso.backend, output: r.output || `session: ${sid}` };
    }
    return fallbackCallback(item);
  };
}
