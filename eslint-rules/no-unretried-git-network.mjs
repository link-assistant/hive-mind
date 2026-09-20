/**
 * ESLint rule to prevent unretried network-facing git commands.
 *
 * Issue #2168: a session died on a transient GitHub failure because the call
 * site had no retry. The `gh` half of that problem is covered by
 * `gh-rate-limit/no-direct-gh-exec` (issue #1726); this rule is the git half.
 *
 * The project retries git network commands by installing the retry on
 * command-stream's `$` tag:
 *
 *   const { $: __rawDollar$ } = await use('command-stream');
 *   const $ = wrapDollarWithGitRetry(__rawDollar$);   // or wrapDollarWithGhRetry
 *
 * so every `$\`git push ...\`` in the file is retried without touching the call
 * site. `gitCmdRetry` from src/lib.mjs is the explicit per-call form.
 *
 * What the rule does:
 *   1. Visits `$\`git push|fetch|pull|ls-remote ...\`` (and the
 *      `$({ cwd })\`...\`` options-call form) plus exec-style calls whose first
 *      argument is such a command.
 *   2. Skips it when the `$`/`exec` identifier resolves to a *function
 *      parameter* — those helpers receive an already-wrapped `$` from their
 *      caller, and the caller is where the wrapper belongs.
 *   3. Otherwise reports unless the file imports one of the known wrappers.
 *
 * `git clone` is not covered on purpose: retrying a clone into a partially
 * written directory fails with "already exists and is not an empty directory",
 * replacing the real diagnosis with a confusing one.
 */

const SAFE_WRAPPER_NAMES = new Set(['gitCmdRetry', 'wrapDollarWithGitRetry', 'wrapDollarWithGhRetry']);

const RAW_EXEC_NAMES = new Set(['exec', 'execAsync', 'execSync', 'execRaw', '$']);

const GIT_NETWORK_SUBCOMMANDS = new Set(['push', 'fetch', 'pull', 'ls-remote']);

const OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

/**
 * @param {string} str - the (possibly interpolated) command text.
 * @returns {boolean} true when `str` starts a git command that reaches the network.
 */
export const looksLikeGitNetworkCommand = str => {
  if (typeof str !== 'string') return false;
  const trimmed = str.trimStart();
  if (!/^git(?:\s|$)/.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/).slice(1);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('-')) return GIT_NETWORK_SUBCOMMANDS.has(token);
    if (OPTIONS_WITH_VALUE.has(token)) i++;
  }
  return false;
};

const flattenTemplateLiteral = node => {
  if (!node || node.type !== 'TemplateLiteral') return '';
  return node.quasis.map(q => q.value.raw).join('${...}');
};

const argLooksLikeGitNetworkCommand = arg => {
  if (!arg) return false;
  if (arg.type === 'Literal' && typeof arg.value === 'string') return looksLikeGitNetworkCommand(arg.value);
  if (arg.type === 'TemplateLiteral') return looksLikeGitNetworkCommand(flattenTemplateLiteral(arg));
  return false;
};

const collectSafeWrapperNames = program => {
  // The wrapper can appear anywhere in the file - as a top-level import, as a
  // `const { wrapDollarWithGhRetry } = await import(...)` inside a function, or
  // simply as the callee of `const $ = wrapDollarWithGitRetry(raw)`. Walking
  // every identifier is the honest way to answer "does this file declare
  // retry awareness".
  const names = new Set();
  const seen = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'Identifier' && SAFE_WRAPPER_NAMES.has(node.name)) names.add(node.name);
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      visit(node[key]);
    }
  };
  visit(program);
  return names;
};

const fileImportsSafeWrapper = program => {
  const names = collectSafeWrapperNames(program);
  for (const safe of SAFE_WRAPPER_NAMES) {
    if (names.has(safe)) return true;
  }
  return false;
};

/** Unwrap `$({ cwd })` back to the `$` identifier node. */
const baseIdentifier = node => {
  let current = node;
  while (current?.type === 'CallExpression') current = current.callee;
  if (current?.type === 'Identifier') return current;
  if (current?.type === 'MemberExpression' && current.property?.type === 'Identifier') return current.property;
  return null;
};

export const _testing = {
  looksLikeGitNetworkCommand,
  flattenTemplateLiteral,
  collectSafeWrapperNames,
  fileImportsSafeWrapper,
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow network-facing git commands (push/fetch/pull/ls-remote) run through a `$` that has no retry wrapper. See src/git-retry.lib.mjs and issue #2168.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      unretriedGitNetwork: "Network git command run through `{{callee}}` without a retry wrapper. Wrap the file's `$` with wrapDollarWithGitRetry (src/git-retry.lib.mjs) or wrapDollarWithGhRetry, or call gitCmdRetry explicitly. See issue #2168.",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    const program = sourceCode.ast;
    const safe = fileImportsSafeWrapper(program);

    // A `$` that arrives from the caller is the caller's job to wrap. That
    // covers both `({ $, tempDir }) => ...` (a Parameter definition) and the
    // equally common `const { $ } = params;` (a destructure off a parameter).
    const comesFromCaller = (identifierNode, node) => {
      if (!identifierNode) return false;
      let scope = sourceCode.getScope ? sourceCode.getScope(node) : null;
      while (scope) {
        const variable = scope.variables.find(v => v.name === identifierNode.name);
        if (variable) {
          return (variable.defs || []).some(def => {
            if (def.type === 'Parameter') return true;
            if (def.type !== 'Variable') return false;
            // `const { $ } = params` / `const { $ } = options.deps`: destructured
            // off a value, not constructed from command-stream in this file.
            return def.node?.id?.type === 'ObjectPattern' && (def.node.init?.type === 'Identifier' || def.node.init?.type === 'MemberExpression');
          });
        }
        scope = scope.upper;
      }
      return false;
    };

    const reportIfUnsafe = (node, calleeNode, gitLike) => {
      if (!gitLike || safe) return;
      const identifier = baseIdentifier(calleeNode);
      if (!identifier || !RAW_EXEC_NAMES.has(identifier.name)) return;
      if (comesFromCaller(identifier, node)) return;
      context.report({ node, messageId: 'unretriedGitNetwork', data: { callee: identifier.name } });
    };

    return {
      CallExpression(node) {
        reportIfUnsafe(node, node.callee, argLooksLikeGitNetworkCommand(node.arguments?.[0]));
      },
      TaggedTemplateExpression(node) {
        reportIfUnsafe(node, node.tag, looksLikeGitNetworkCommand(flattenTemplateLiteral(node.quasi)));
      },
    };
  },
};
