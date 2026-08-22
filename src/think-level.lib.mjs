#!/usr/bin/env node

/**
 * Issue #2038: Canonical normalization of the `--think` option.
 *
 * The `--think` flag historically accepted only a small fixed set of keyword
 * levels (off/low/medium/high/xhigh/ultra/max). Issue #2038 requires a much
 * richer and more forgiving surface, mapped consistently across Claude and
 * Codex:
 *
 *   1. A family of synonyms that all mean "off" (thinking disabled, or the
 *      closest safe equivalent when a model cannot truly disable thinking):
 *      `off`, `disable`, `disabled`, `no`, `none`, `false`.
 *   2. A `minimal` level (below `low`) mapped to the lowest real reasoning
 *      effort each tool supports (Codex `minimal`, Claude lowest effort).
 *   3. An explicit `adaptive` level that requests provider-managed adaptive
 *      thinking and MUST fail fast for models/tools that do not support it.
 *   4. Numeric intensities so users can dial precision:
 *        - percentages `0%` .. `100%`
 *        - fractions   `0.0` .. `1.0`
 *        - the integers `0` and `1`
 *      `0`/`0%`/`0.0` == off and `1`/`100%`/`1.0` == max.
 *
 * `normalizeThinkLevel()` folds every accepted spelling into one canonical
 * level so the rest of the codebase keeps operating on a single vocabulary.
 */

// Canonical think levels in ascending intensity order. `adaptive` is a distinct
// mode (provider-managed), not a point on the numeric intensity scale, so it is
// listed separately and never produced by numeric coercion.
export const CANONICAL_THINK_LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra', 'max']);

export const ADAPTIVE_THINK_LEVEL = 'adaptive';

// Keyword synonyms → canonical level. All the "off" spellings are synonyms per
// the issue title, and an omitted `--think` is treated as `off` elsewhere.
const THINK_LEVEL_SYNONYMS = Object.freeze({
  off: 'off',
  disable: 'off',
  disabled: 'off',
  no: 'off',
  none: 'off',
  false: 'off',
  min: 'minimal',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  med: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  'x-high': 'xhigh',
  ultra: 'ultra',
  max: 'max',
  maximum: 'max',
  full: 'max',
  adaptive: 'adaptive',
  auto: 'adaptive',
});

/**
 * Map a fraction in [0, 1] to a canonical intensity level.
 * 0 → off, 1 → max, with evenly spaced bands in between. Never returns the
 * out-of-band `ultra` (multi-agent) or `adaptive` modes.
 * @param {number} fraction
 * @returns {string}
 */
export const fractionToThinkLevel = fraction => {
  if (!Number.isFinite(fraction) || fraction <= 0) return 'off';
  if (fraction < 0.2) return 'minimal';
  if (fraction < 0.4) return 'low';
  if (fraction < 0.6) return 'medium';
  if (fraction < 0.8) return 'high';
  if (fraction < 1) return 'xhigh';
  return 'max';
};

/**
 * Parse a numeric think value (percentage, fraction, or 0/1 integer) into a
 * fraction in [0, 1], or return null when the value is not numeric.
 * @param {string} raw
 * @returns {number|null}
 */
export const parseNumericThinkValue = raw => {
  const text = String(raw).trim();
  const percentMatch = /^([0-9]+(?:\.[0-9]+)?)\s*%$/.exec(text);
  if (percentMatch) {
    return Math.min(1, Math.max(0, Number(percentMatch[1]) / 100));
  }
  if (/^[0-9]+(?:\.[0-9]+)?$/.exec(text)) {
    const num = Number(text);
    // Bare integers greater than 1 are treated as a 0..100 style percentage so
    // `--think 50` behaves like `--think 50%`; 0 and 1 stay canonical fraction
    // endpoints (off and max).
    if (num > 1) return Math.min(1, num / 100);
    return Math.min(1, Math.max(0, num));
  }
  return null;
};

/**
 * Normalize any accepted `--think` spelling into a canonical level.
 * @param {string|number|undefined|null} raw
 * @returns {string|undefined} canonical level, ADAPTIVE_THINK_LEVEL, or
 *   undefined when input is empty. Throws for unrecognized values.
 */
export const normalizeThinkLevel = raw => {
  if (raw === undefined || raw === null || raw === '') return undefined;

  // Already-canonical (e.g. re-normalization) short circuit.
  if (typeof raw === 'string') {
    const lowered = raw.trim().toLowerCase();
    if (lowered === '') return undefined;

    if (Object.prototype.hasOwnProperty.call(THINK_LEVEL_SYNONYMS, lowered)) {
      return THINK_LEVEL_SYNONYMS[lowered];
    }

    const fraction = parseNumericThinkValue(lowered);
    if (fraction !== null) {
      return fractionToThinkLevel(fraction);
    }

    throw new Error(`Invalid --think value: "${raw}". Use a level (${CANONICAL_THINK_LEVELS.join(', ')}, adaptive), ` + `an off synonym (off/disable/disabled/no/none), a percentage (0%..100%), or a fraction (0.0..1.0).`);
  }

  if (typeof raw === 'number') {
    const fraction = raw > 1 ? Math.min(1, raw / 100) : Math.min(1, Math.max(0, raw));
    return fractionToThinkLevel(fraction);
  }

  throw new Error(`Invalid --think value: "${raw}".`);
};

export default {
  CANONICAL_THINK_LEVELS,
  ADAPTIVE_THINK_LEVEL,
  normalizeThinkLevel,
  fractionToThinkLevel,
  parseNumericThinkValue,
};
