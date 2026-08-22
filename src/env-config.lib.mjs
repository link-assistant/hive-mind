/**
 * Parse numeric environment configuration without silently accepting malformed
 * suffixes or discarding explicit operator input.
 */

const emittedWarnings = new Set();

function warnOnce(key, message) {
  if (emittedWarnings.has(key)) return;
  emittedWarnings.add(key);
  console.warn(message);
}

function readExplicitEnv(envVar) {
  const rawValue = process.env[envVar];
  return rawValue === undefined ? null : rawValue;
}

/**
 * Emit a warning once when an environment variable was explicitly configured.
 *
 * @param {string} envVar
 * @param {string} warningKey
 * @param {string} message
 */
export function warnExplicitEnv(envVar, warningKey, message) {
  if (readExplicitEnv(envVar) !== null) {
    warnOnce(`${warningKey}:${envVar}`, message);
  }
}

function warnInvalid(envVar, rawValue, type, defaultValue, scope) {
  warnOnce(`invalid:${envVar}`, `[${scope}] ${envVar}=${JSON.stringify(rawValue)} is not a valid ${type}; using default ${defaultValue}.`);
}

/**
 * Read a base-10 integer environment variable.
 *
 * @param {string} envVar
 * @param {number} defaultValue
 * @param {{scope?: string}} [options]
 * @returns {number}
 */
export function parseIntegerEnv(envVar, defaultValue, { scope = 'config' } = {}) {
  const rawValue = readExplicitEnv(envVar);
  if (rawValue === null) return defaultValue;

  const normalized = rawValue.trim();
  if (!/^[+-]?\d+$/.test(normalized)) {
    warnInvalid(envVar, rawValue, 'integer', defaultValue, scope);
    return defaultValue;
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    warnInvalid(envVar, rawValue, 'integer', defaultValue, scope);
    return defaultValue;
  }

  return parsed;
}

/**
 * Read a finite decimal environment variable.
 *
 * @param {string} envVar
 * @param {number} defaultValue
 * @param {{scope?: string}} [options]
 * @returns {number}
 */
export function parseNumberEnv(envVar, defaultValue, { scope = 'config' } = {}) {
  const rawValue = readExplicitEnv(envVar);
  if (rawValue === null) return defaultValue;

  const normalized = rawValue.trim();
  const isDecimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized);
  const parsed = Number(normalized);
  if (!isDecimal || !Number.isFinite(parsed)) {
    warnInvalid(envVar, rawValue, 'number', defaultValue, scope);
    return defaultValue;
  }

  return parsed;
}

/**
 * Apply a safety bound and explain when it changes an explicitly configured
 * environment value.
 *
 * @param {string} envVar
 * @param {number} value
 * @param {{minimum?: number, maximum?: number, scope?: string, hint?: string}} options
 * @returns {number}
 */
export function clampEnvValue(envVar, value, { minimum, maximum, scope = 'config', hint = '' }) {
  if (minimum !== undefined && value < minimum) {
    if (readExplicitEnv(envVar) !== null) {
      warnOnce(`minimum:${envVar}`, `[${scope}] ${envVar}=${value} is below the minimum (${minimum}); using ${minimum}.${hint ? ` ${hint}` : ''}`);
    }
    return minimum;
  }

  if (maximum !== undefined && value > maximum) {
    if (readExplicitEnv(envVar) !== null) {
      warnOnce(`maximum:${envVar}`, `[${scope}] ${envVar}=${value} exceeds the maximum (${maximum}); using ${maximum}.${hint ? ` ${hint}` : ''}`);
    }
    return maximum;
  }

  return value;
}
