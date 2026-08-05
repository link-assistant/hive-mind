/**
 * Usage-field vocabulary and JSON-path helpers for the `codex exec --json`
 * parser.
 *
 * Split out of codex.lib.mjs to keep that file inside the max-lines budget
 * (issues #1730 / #1990 / #2140). Everything here is pure data plus pure
 * lookups: codex has renamed and re-nested its usage fields several times
 * across releases, so the parser reads whichever spelling is *present* rather
 * than assuming one shape, and reports what it actually observed.
 */

/** Every usage field name we know codex has used, for observability reporting. */
export const CODEX_USAGE_FIELD_NAMES = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_creation_input_tokens', 'reasoning_tokens', 'reasoning_output_tokens', 'input_tokens_details.cached_tokens', 'input_tokens_details.cache_read_tokens', 'input_tokens_details.cache_write_tokens', 'input_tokens_details.cache_creation_tokens', 'input_tokens_details.cache_creation_input_tokens', 'output_tokens_details.reasoning_tokens'];

/** Places a codex event has been seen to name a model, in preference order. */
export const CODEX_MODEL_DIAGNOSTIC_PATHS = [
  ['model', data => data?.model],
  ['model_name', data => data?.model_name],
  ['from_model', data => data?.from_model],
  ['to_model', data => data?.to_model],
  ['message.model', data => data?.message?.model],
];

export const CODEX_CACHE_READ_USAGE_PATHS = ['cached_input_tokens', 'input_tokens_details.cached_tokens', 'input_tokens_details.cache_read_tokens'];
export const CODEX_CACHE_WRITE_USAGE_PATHS = ['cache_write_tokens', 'cache_creation_input_tokens', 'input_tokens_details.cache_write_tokens', 'input_tokens_details.cache_creation_tokens', 'input_tokens_details.cache_creation_input_tokens'];
export const CODEX_REASONING_USAGE_PATHS = ['reasoning_tokens', 'reasoning_output_tokens', 'output_tokens_details.reasoning_tokens'];

/** Which token kinds this run has actually seen codex report. */
export const createCodexTokenFieldAvailability = () => ({
  inputTokens: false,
  outputTokens: false,
  reasoningTokens: false,
  cacheReadTokens: false,
  cacheWriteTokens: false,
});

/** Own-property check along a dotted path — absent ≠ present-and-zero. */
export const hasOwnPath = (object, pathName) => {
  let cursor = object;
  for (const part of pathName.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !Object.hasOwn(cursor, part)) return false;
    cursor = cursor[part];
  }
  return true;
};

export const getPathValue = (object, pathName) => pathName.split('.').reduce((cursor, part) => cursor?.[part], object);

/** First path that is actually present wins; a non-finite value counts as 0. */
export const getFirstObservedNumber = (object, pathNames) => {
  for (const pathName of pathNames) {
    if (!hasOwnPath(object, pathName)) continue;
    const value = getPathValue(object, pathName);
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
};

export const hasAnyObservedPath = (object, pathNames) => pathNames.some(pathName => hasOwnPath(object, pathName));
