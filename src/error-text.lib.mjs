/**
 * Shared human-readable rendering of structured error payloads (issue #2141).
 *
 * Agentic CLIs publish errors as *objects*, not strings. `@link-assistant/agent`
 * 0.25.x emits `NamedError.toObject()`:
 *
 *   {"type":"error","error":{"name":"RetryTimeoutExceededError","data":{"message":"…"}}}
 *
 * Every adapter that interpolated such a payload into a template literal
 * (`Agent reported error: ${outputError.match}`) destroyed the diagnosis and
 * published `AGENT execution failed with Agent reported error: [object Object]`
 * to the GitHub issue, which is what issue #2141 reported. This module turns any
 * of those shapes into text a human can act on, and is reused by every tool
 * adapter so the defect cannot come back in one CLI at a time.
 */

export const MAX_ERROR_TEXT_LENGTH = 2000;

/** Text that carries no diagnostic value even though it is a non-empty string. */
const PLACEHOLDER_ERROR_TEXTS = new Set(['[object object]', '[object error]', 'undefined', 'null', '{}', '[]']);

/**
 * `[object Object]` (and friends) must never be published as a failure reason:
 * it is the symptom this module exists to remove, so callers can assert on it.
 */
export const isPlaceholderErrorText = value => {
  if (typeof value !== 'string') return false;
  return PLACEHOLDER_ERROR_TEXTS.has(value.trim().toLowerCase());
};

const truncateErrorText = (text, maxLength) => {
  if (typeof text !== 'string') return '';
  if (!Number.isFinite(maxLength) || maxLength <= 0) return text;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}… (truncated)`;
};

const safeJsonStringify = value => {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, entry) => {
      if (entry && typeof entry === 'object') {
        if (seen.has(entry)) return '[Circular]';
        seen.add(entry);
      }
      if (typeof entry === 'bigint') return entry.toString();
      if (typeof entry === 'function') return `[Function ${entry.name || 'anonymous'}]`;
      return entry;
    });
  } catch {
    return null;
  }
};

const joinParts = parts => parts.filter(part => typeof part === 'string' && part.trim().length > 0).join(': ');

const stringifyValue = (value, depth) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol' || typeof value === 'function') return String(value);

  if (Array.isArray(value)) {
    if (depth > 4) return safeJsonStringify(value) || String(value);
    const rendered = value
      .map(entry => stringifyValue(entry, depth + 1))
      .filter(Boolean)
      .join('; ');
    return rendered || safeJsonStringify(value) || String(value);
  }

  if (typeof value !== 'object') return String(value);
  if (depth > 4) return safeJsonStringify(value) || String(value);

  if (value instanceof Error) {
    const rendered = joinParts([value.name && value.name !== 'Error' ? value.name : '', value.message]);
    return rendered || value.name || 'Error';
  }

  // `NamedError.toObject()` from @link-assistant/agent: {name, data:{message,…}}.
  // The name alone ("RetryTimeoutExceededError") is already actionable, so keep
  // it even when `data` carries no message.
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null;

  const nestedCandidates = [value.message, value.data, value.error, value.reason, value.cause, value.detail, value.details, value.description, value.hint, value.result, value.stderr];

  for (const candidate of nestedCandidates) {
    if (candidate === null || candidate === undefined) continue;
    const rendered = stringifyValue(candidate, depth + 1);
    if (!rendered || isPlaceholderErrorText(rendered)) continue;
    // Avoid "Foo: Foo" when the nested value repeats the name.
    if (name && rendered === name) return name;
    return joinParts([name, rendered]);
  }

  if (name) return name;

  const json = safeJsonStringify(value);
  if (json && json !== '{}') return json;
  return '';
};

/**
 * Render any error payload (string, Error, NamedError object, nested envelope,
 * array of the above) as a single human-readable line.
 *
 * @param {unknown} value - the payload as received from the tool stream.
 * @param {object} [options]
 * @param {number} [options.maxLength] - truncation budget for the rendered text.
 * @param {string} [options.fallback] - returned when nothing readable is found.
 * @returns {string} readable text, never `[object Object]`.
 */
export const stringifyErrorValue = (value, { maxLength = MAX_ERROR_TEXT_LENGTH, fallback = '' } = {}) => {
  const rendered = stringifyValue(value, 0);
  if (!rendered || isPlaceholderErrorText(rendered)) return fallback;
  return truncateErrorText(rendered, maxLength);
};

/**
 * Pick the first readable rendering among several candidate payloads.
 * Used where an adapter has to try `data.message`, then `data.error`, then the
 * raw record text (the exact chain that produced `[object Object]` before).
 */
export const firstErrorText = (candidates, { maxLength = MAX_ERROR_TEXT_LENGTH, fallback = '' } = {}) => {
  for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
    const rendered = stringifyErrorValue(candidate, { maxLength });
    if (rendered) return rendered;
  }
  return fallback;
};
