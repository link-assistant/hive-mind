/**
 * Formal AI model identity — the smallest module that can answer "is this task
 * driven by Formal AI?".
 *
 * These three symbols used to live in `src/models/index.mjs`, which bootstraps
 * `use-m` at import time and therefore reaches the network. The Formal AI
 * sidecar lifecycle (issue #2146) is imported by the isolation runner, whose
 * own regression test asserts that importing it performs no network fetch, so
 * the identity check has to be reachable without dragging the whole model
 * catalogue in. `src/models/index.mjs` re-exports these so there is still a
 * single definition.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 */

/** The alias users type: `--model formal-ai`. */
export const FORMAL_AI_MODEL_ALIAS = 'formal-ai';

/** The provider-qualified id used when a tool routes through a provider. */
export const FORMAL_AI_PROVIDER_MODEL_ID = 'formalai/formal-ai';

/** Every tool that can run Formal AI — the one list validation and the runtime share. */
export const FORMAL_AI_SUPPORTED_TOOLS = Object.freeze(['claude', 'agent', 'opencode', 'codex', 'qwen', 'gemini']);

/**
 * The canonical spelling of a Formal AI model string, or null for any other
 * model. Model validation is case-insensitive (`--model Formal-AI` passes it),
 * so the identity check has to be too: otherwise a miscased Formal AI model
 * would skip the sidecar and the runtime wiring, and the client CLI would send
 * it to its vendor's endpoint. No Anthropic or OpenAI id lowercases to either
 * spelling, so vendor models are unaffected.
 */
export const canonicalFormalAiModel = model => {
  if (typeof model !== 'string') return null;
  const normalized = model.trim().toLowerCase();
  return normalized === FORMAL_AI_MODEL_ALIAS || normalized === FORMAL_AI_PROVIDER_MODEL_ID ? normalized : null;
};

/** True when a model string names Formal AI in either spelling, in any case. */
export const isFormalAiModel = model => canonicalFormalAiModel(model) !== null;

export default { FORMAL_AI_MODEL_ALIAS, FORMAL_AI_PROVIDER_MODEL_ID, FORMAL_AI_SUPPORTED_TOOLS, canonicalFormalAiModel, isFormalAiModel };
