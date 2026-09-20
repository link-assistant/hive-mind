#!/usr/bin/env node

/**
 * Shared fatal-error formatting (issue #2092).
 *
 * The failing `/fix --ci-cd` runs printed exactly one line:
 *
 *   ❌ Failed to import module from '/home/box/.../command-stream-v-latest/src/$.mjs'.
 *
 * because the entry points did `console.error(\`❌ ${error.message}\`)`. Everything
 * that would have identified the problem — the `SyntaxError` in `error.cause`,
 * the stack showing which module triggered the load — was discarded, so the
 * first investigation had to guess. This helper keeps the one-line summary but
 * appends the cause chain, and the full stacks when verbose output is enabled.
 */

const MAX_CAUSE_DEPTH = 5;

/**
 * @param {unknown} error - the thrown value.
 * @param {object} [options]
 * @param {boolean} [options.verbose] - include stacks; defaults to the
 *   `HIVE_MIND_VERBOSE` / `VERBOSE` environment variables.
 * @returns {string} a multi-line, human-readable rendering of the error.
 */
export const formatFatalError = (error, options = {}) => {
  const verbose = options.verbose ?? Boolean(process.env.HIVE_MIND_VERBOSE || process.env.VERBOSE);
  const lines = [`❌ ${describe(error)}`];

  let current = error?.cause;
  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth++) {
    lines.push(`   Caused by: ${describe(current)}`);
    if (verbose && typeof current?.stack === 'string') lines.push(indent(current.stack));
    current = current?.cause;
  }

  if (verbose && typeof error?.stack === 'string') lines.push(indent(error.stack));
  return lines.join('\n');
};

const describe = value => {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return String(value);
  const name = value.name || value.constructor?.name || 'Error';
  const message = typeof value.message === 'string' && value.message ? value.message : JSON.stringify(value);
  const code = value.code ? ` (code: ${value.code})` : '';
  return `${name}: ${message}${code}`;
};

const indent = text =>
  String(text)
    .split('\n')
    .map(line => `     ${line}`)
    .join('\n');
