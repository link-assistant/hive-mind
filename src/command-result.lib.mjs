/**
 * Dependency-free helpers for command-stream results (issue #3001).
 */

/**
 * Throw when a command-stream result reports a non-zero exit.
 *
 * command-stream's `$` resolves — it does not throw — when the child exits
 * non-zero (or is missing: exit 127). Probes written as
 * `try { await $\`cmd\`; return true; } catch { return false; }` therefore
 * reported every failure as success: a missing image as present, a missing
 * tmux session as running, an unreadable Docker data root as "could not parse
 * df output" (issues #2189, #3001). Wrap the awaited result with this so the
 * catch block sees the failure, with `code`/`stdout`/`stderr` on the error.
 *
 * @param {{code?: number, stdout?: any, stderr?: any}} result - Resolved `$` result
 * @param {string} label - Command name for the error message
 * @returns {Object} The same result when the exit code is 0
 */
export function assertCommandSucceeded(result, label = 'command') {
  const code = Number.isFinite(result?.code) ? result.code : 0;
  if (code === 0) return result;
  // Callers often redirect `2>&1`, so the reason may only be on stdout.
  const reason = result?.stderr?.toString?.().trim() || result?.stdout?.toString?.().trim() || '';
  const error = new Error(`${label} exited with code ${code}${reason ? `: ${reason.split('\n')[0]}` : ''}`);
  error.code = code;
  error.stdout = result?.stdout;
  error.stderr = result?.stderr;
  throw error;
}
