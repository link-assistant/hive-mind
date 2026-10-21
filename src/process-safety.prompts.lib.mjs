/**
 * Process-kill safety rule for every AI tool's system prompt (issues #744, #733).
 *
 * On 2025-11-14 a session without Docker isolation hit EADDRINUSE, decided to
 * "kill all node processes" and ran `pkill -9 node`. The Telegram bot ran as the
 * same user on the same host, so it died with the session's dev server (#733).
 * Docker isolation prevents this; the rule below covers sessions without it and
 * the tools that have no deny-rule mechanism (only Claude gets
 * PROCESS_KILL_DENY_RULES from useless-tools.lib.mjs).
 */

export const PROCESS_SAFETY_RULES = Object.freeze(['Stop only processes you started, by the PID you recorded when you started them (for example: start the server in the background, save $! to a file, and later kill that PID).', 'Never run broad process-kill commands such as pkill node, pkill -f with a broad pattern, killall, kill -9 -1 or kill 0: they also kill the bot, the other sessions and the tool running you, because they may run as the same user on the same machine.', 'When a port is already in use (EADDRINUSE), find the owner with lsof -i :PORT or ss -ltnp; stop it only when it is a process you started, otherwise use another port.']);

/** System prompt section for claude, codex, agent, gemini, opencode and qwen. */
export function getProcessSafetySubPrompt() {
  return `

Process safety.
${PROCESS_SAFETY_RULES.map(rule => `   - ${rule}`).join('\n')}`;
}
