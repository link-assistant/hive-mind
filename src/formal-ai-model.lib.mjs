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

/** True when a model string names Formal AI in either spelling. */
export const isFormalAiModel = model => model === FORMAL_AI_MODEL_ALIAS || model === FORMAL_AI_PROVIDER_MODEL_ID;

export default { FORMAL_AI_MODEL_ALIAS, FORMAL_AI_PROVIDER_MODEL_ID, isFormalAiModel };
