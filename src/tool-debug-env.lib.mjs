/**
 * Issue #2837: SDK/CLI debug tracing of the AI tools is its own opt-in.
 *
 * `--verbose` used to imply `RUST_LOG=debug` for Codex and `ANTHROPIC_LOG=debug`
 * for Claude. Both stamp account identifiers on nearly every line — Codex OTEL
 * events carry `user.email` and `user.account_id`, Anthropic SDK header dumps
 * carry `anthropic-organization-id` and `anthropic-workspace-id` — and together
 * made up a third to a half of a verbose log. `--verbose` now keeps hive-mind's
 * own diagnostics only; `--codex-debug` / `--anthropic-debug` turn the tracing
 * on explicitly. A `RUST_LOG` / `ANTHROPIC_LOG` already exported by the
 * operator is still inherited unchanged.
 */

export const CODEX_DEBUG_RUST_LOG = 'debug';
export const ANTHROPIC_DEBUG_LOG = 'debug';

/**
 * Environment for a `codex exec` child process.
 * @param {boolean} [codexDebug] - `--codex-debug`
 * @param {Object} [baseEnv]
 * @returns {Object}
 */
export const getCodexExecEnv = (codexDebug = false, baseEnv = process.env) => (codexDebug ? { ...baseEnv, RUST_LOG: CODEX_DEBUG_RUST_LOG } : { ...baseEnv });

/**
 * Turn on Anthropic SDK debug logging in a Claude child environment when
 * `--anthropic-debug` was given. Mutates and returns `env`.
 * @param {Object} env
 * @param {Object} argv
 * @returns {Object}
 */
export const applyAnthropicDebugEnv = (env, argv) => {
  if (argv?.anthropicDebug) env.ANTHROPIC_LOG = ANTHROPIC_DEBUG_LOG;
  return env;
};
