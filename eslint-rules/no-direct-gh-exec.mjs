/**
 * ESLint rule to prevent unsafe direct exec() calls to `gh`.
 *
 * Issue #1726: every gh API call site must be rate-limit safe. The project
 * provides three wrappers that add the required behaviour (sleep until reset
 * + buffer + jitter, retry on transient network errors, propagate other errors):
 *
 *   - `ghWithRateLimitRetry`        — for arbitrary fns; preferred for new code
 *   - `execGhWithRetry`             — drop-in for child_process.exec strings
 *   - `ghCmdRetry`/`ghRetry`        — legacy wrappers in src/lib.mjs (now layer
 *                                     rate-limit retry on top of the existing
 *                                     transient-network retry)
 *
 * The merge subsystem hides several occurrences of `exec(\`gh ...\`)` behind a
 * locally-rebound `exec` shim that wraps `ghWithRateLimitRetry`. That pattern
 * is allowed because the rebinding is the safety belt itself — but ONLY when
 * the `exec` identifier in the same file is bound through a wrapper that
 * imports `ghWithRateLimitRetry` (or one of its callers).
 *
 * What the rule does:
 *   1. Visits TaggedTemplateExpression / CallExpression where the callee is
 *      `exec`/`execAsync`/`execRaw` and the first argument or template
 *      contains `gh ` at the start of a token.
 *   2. Reports the call UNLESS the source file imports a known-safe wrapper
 *      (`ghWithRateLimitRetry`, `execGhWithRetry`, `ghRetry`, `ghCmdRetry`).
 *
 * The rule is intentionally lenient — it surfaces the obvious unsafe pattern
 * (raw exec to `gh ...` with no rate-limit-aware import in scope) and lets
 * developers opt in by importing one of the wrappers.
 */

const SAFE_WRAPPER_NAMES = new Set(['ghWithRateLimitRetry', 'execGhWithRetry', 'ghRetry', 'ghCmdRetry', 'wrapDollarWithGhRetry']);

const RAW_EXEC_NAMES = new Set(['exec', 'execAsync', 'execSync', 'execRaw', '$']);

const looksLikeGhCommand = str => {
  if (typeof str !== 'string') return false;
  const trimmed = str.trimStart();
  return /^gh(?:\s|$)/.test(trimmed);
};

const flattenTemplateLiteral = node => {
  if (!node || node.type !== 'TemplateLiteral') return '';
  return node.quasis.map(q => q.value.raw).join('${...}');
};

const argLooksLikeGhCommand = arg => {
  if (!arg) return false;
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    return looksLikeGhCommand(arg.value);
  }
  if (arg.type === 'TemplateLiteral') {
    return looksLikeGhCommand(flattenTemplateLiteral(arg));
  }
  return false;
};

const collectImportedNames = program => {
  const names = new Set();
  for (const stmt of program.body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    for (const spec of stmt.specifiers || []) {
      // Match both the local binding (e.g. `_wrapDollar`) and the imported
      // source name (e.g. `wrapDollarWithGhRetry`). This lets a file declare
      // rate-limit awareness via `import { wrapDollarWithGhRetry as _x }`.
      if (spec.local && spec.local.name) names.add(spec.local.name);
      if (spec.imported && spec.imported.name) names.add(spec.imported.name);
    }
  }
  // Also detect `const { x } = await import(...)` / `require(...)`.
  for (const stmt of program.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const decl of stmt.declarations) {
      if (decl.id?.type === 'ObjectPattern') {
        for (const prop of decl.id.properties) {
          if (prop.type === 'Property') {
            // Capture the property's source name (key), since destructured
            // renames like `{ wrapDollarWithGhRetry: _x } = await import(...)`
            // should still count as importing the safe wrapper.
            if (prop.key?.type === 'Identifier') names.add(prop.key.name);
            if (prop.value?.type === 'Identifier') names.add(prop.value.name);
          }
        }
      } else if (decl.id?.type === 'Identifier') {
        names.add(decl.id.name);
      }
    }
  }
  return names;
};

const fileImportsSafeWrapper = program => {
  const names = collectImportedNames(program);
  for (const safe of SAFE_WRAPPER_NAMES) {
    if (names.has(safe)) return true;
  }
  return false;
};

export const _testing = {
  looksLikeGhCommand,
  flattenTemplateLiteral,
  collectImportedNames,
  fileImportsSafeWrapper,
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw exec/execAsync/$ calls to `gh` without a rate-limit-safe wrapper. ' + 'See src/github-rate-limit.lib.mjs and issue #1726.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      directGhExec: 'Direct `{{callee}}` call to `gh` is not rate-limit safe. ' + 'Wrap with ghWithRateLimitRetry/execGhWithRetry from src/github-rate-limit.lib.mjs ' + '(or rebind `exec` through one of those wrappers at the top of the file). ' + 'See issue #1726.',
    },
    schema: [],
  },

  create(context) {
    const program = context.sourceCode?.ast || context.getSourceCode().ast;
    const safe = fileImportsSafeWrapper(program);

    const reportIfUnsafe = (node, calleeName, ghLike) => {
      if (!ghLike) return;
      if (safe) return; // file declares it is rate-limit aware
      context.report({
        node,
        messageId: 'directGhExec',
        data: { callee: calleeName },
      });
    };

    return {
      CallExpression(node) {
        const callee = node.callee;
        let calleeName = null;
        if (callee.type === 'Identifier') calleeName = callee.name;
        else if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
          calleeName = callee.property.name;
        }
        if (!calleeName || !RAW_EXEC_NAMES.has(calleeName)) return;
        const firstArg = node.arguments?.[0];
        reportIfUnsafe(node, calleeName, argLooksLikeGhCommand(firstArg));
      },

      TaggedTemplateExpression(node) {
        // Handle command-stream / zx style: $`gh ...`
        const tag = node.tag;
        let calleeName = null;
        if (tag.type === 'Identifier') calleeName = tag.name;
        else if (tag.type === 'MemberExpression' && tag.property?.type === 'Identifier') {
          calleeName = tag.property.name;
        }
        if (!calleeName || !RAW_EXEC_NAMES.has(calleeName)) return;
        const ghLike = looksLikeGhCommand(flattenTemplateLiteral(node.quasi));
        reportIfUnsafe(node, calleeName, ghLike);
      },
    };
  },
};
