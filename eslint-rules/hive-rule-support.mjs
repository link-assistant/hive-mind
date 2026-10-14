/**
 * Shared pieces of the `hive/*` lint rules: reasoned inline exceptions and
 * per-file baselines for findings that existed before a rule was introduced.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

/** JSON-schema fragment for a `baseline: { 'src/file.mjs': count }` option. */
export const BASELINE_SCHEMA = { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } };

/**
 * True when the line of `node`, or a comment-only line right above it,
 * carries `// <marker>: <reason>` (the reason is required).
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Node} node
 * @param {string} marker - e.g. `hive-sync-ok`
 */
export function hasReasonedMarker(sourceCode, node, marker) {
  const pattern = new RegExp(`//\\s*${marker}:\\s*\\S`);
  const lineIndex = node.loc.start.line - 1;
  if (pattern.test(sourceCode.lines[lineIndex] || '')) return true;
  const above = sourceCode.lines[lineIndex - 1] || '';
  return /^\s*\/\//.test(above) && pattern.test(above);
}

/**
 * Path of the linted file relative to the working directory, POSIX separators.
 *
 * @param {import('eslint').Rule.RuleContext} context
 */
export function relativeFilename(context) {
  const cwd = (context.cwd || process.cwd()).replace(/\\/g, '/');
  const filename = (context.filename || '').replace(/\\/g, '/');
  return filename.startsWith(`${cwd}/`) ? filename.slice(cwd.length + 1) : filename;
}

/**
 * The variable an identifier refers to, looking outward from its scope.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Identifier} identifier
 * @returns {import('eslint').Scope.Variable|null}
 */
export function findVariable(sourceCode, identifier) {
  for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
  }
  return null;
}

/**
 * Collect findings during traversal and report them at the end of the file,
 * unless the file is within its baseline count.
 *
 * @param {import('eslint').Rule.RuleContext} context
 * @param {Record<string, number>} baseline
 * @returns {{ add: (finding: { node: object, data: object }) => void, flush: () => void }}
 */
export function createBaselineReporter(context, baseline = {}) {
  const allowed = baseline[relativeFilename(context)] ?? 0;
  const findings = [];
  return {
    add(finding) {
      findings.push(finding);
    },
    flush() {
      if (findings.length <= allowed) return;
      for (const { node, data } of findings) {
        if (allowed === 0) context.report({ node, messageId: 'violation', data });
        else context.report({ node, messageId: 'overBaseline', data: { ...data, allowed: String(allowed), count: String(findings.length) } });
      }
    },
  };
}
