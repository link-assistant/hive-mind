/**
 * Shared call-site analysis for the "every GitHub operation is retried" rules
 * (`gh-rate-limit/no-direct-gh-exec` and `gh-rate-limit/no-unretried-git-network`).
 *
 * Issue #3552 follow-up: both rules used to accept a call as soon as the *file*
 * mentioned a retry wrapper anywhere. One wrapped `$` at the top of a file
 * therefore exempted a raw `execFile('gh', ...)` lower down, and the
 * `spawn`/`execFile` argv style (`run('gh', ['api', ...])`) was not looked at at
 * all. The analysis below decides per call site instead:
 *
 *   1. Is this a GitHub operation? `classifyGitHubCommand` from
 *      src/github-operation-retry.lib.mjs is the single definition - the same
 *      function the runtime wrappers use to decide what to retry.
 *   2. Is it retried? Yes when any of:
 *      - it runs inside a function handed to a retry helper
 *        (`ghWithRateLimitRetry(() => $\`gh ...\`)`), directly or via a named
 *        function / variable that is passed to one;
 *      - its executor resolves to a value built by a wrap factory
 *        (`const $ = wrapDollarWithGhRetry(raw)`, `$({ cwd })` of such a `$`,
 *        aliases of it, every assignment of a lazily bound `let $`);
 *      - its executor is a local helper whose own body goes through a retry
 *        helper or wrap factory;
 *      - its executor is a retry helper itself (`execGhWithRetry('gh ...')`);
 *      - its executor arrives from the caller (a parameter, or destructured off
 *        a parameter/options object): the caller owns the wrapper - and a
 *        parameter default (`run = runCommand`) must itself be retrying;
 *      - the runner is handed to a helper as an argument
 *        (`commandOutput(run, 'gh', args)`) and that runner is retrying.
 *   3. Otherwise it is reported, unless the line (or the one above it) carries
 *      `// github-retry-ok: <reason>` - for interactive or deliberately
 *      single-shot calls, where the reason documents why.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { classifyGitHubCommand } from '../src/github-operation-retry.lib.mjs';

/** Functions whose function-valued arguments run under the shared retry loop. */
export const RETRY_HELPER_NAMES = new Set(['ghWithRateLimitRetry', 'execGhWithRetry', 'ghRetry', 'ghCmdRetry', 'gitCmdRetry', 'retryGitHubOperation']);

/** Factories that return an executor which retries the GitHub operations it starts. */
export const WRAP_FACTORY_NAMES = new Set(['wrapDollarWithGhRetry', 'wrapDollarWithGitRetry', 'wrapRunnerWithGitHubRetry', 'wrapRunnerWithTransientRetry']);

/** Executors that are retry-safe by name (they take the command directly). */
const SAFE_EXECUTOR_NAMES = new Set(['execGhWithRetry']);

export const ESCAPE_COMMENT = 'github-retry-ok:';

/**
 * Calls that take a command *string* without running it: classification,
 * assertions, logging, collection building, string tests. A string that merely
 * mentions `gh pr view` there is not a call site. Everything else that is
 * handed a GitHub command (`$`, `exec`, `execFile`, `spawn`, `commandOutput`,
 * `run`, any project helper) is treated as running it, so a new executor name
 * cannot slip past the rule.
 */
const NON_EXECUTOR_NAME_PATTERN = /^(classify|describe|match|matches|is[A-Z]|has[A-Z]|assert|equal|deepEqual|strictEqual|notEqual|ok|fail|throws|rejects|includes|startsWith|endsWith|indexOf|push|unshift|concat|join|set|add|get|log|warn|error|info|debug|trace|verbose|format|parse|split|replace|test|toBe|toEqual|toContain|toMatch|expect|describe|it|t|test|runTest|subtest)$|^(log|detect|format|classify|describe|match|is[A-Z]|has[A-Z]|assert|parse|quote|escape|sanitize|redact|mask|print|report|emit)/;
const NON_EXECUTOR_OBJECTS = new Set(['console', 'assert', 'JSON', 'path', 'Object', 'Array', 'Promise', 'RegExp', 'String']);

const isNonExecutorCallee = callee => {
  const base = callee?.type === 'MemberExpression' ? callee : null;
  if (base && base.object?.type === 'Identifier' && NON_EXECUTOR_OBJECTS.has(base.object.name)) return true;
  const name = callee?.type === 'Identifier' ? callee.name : callee?.type === 'MemberExpression' && !callee.computed ? callee.property?.name : null;
  return Boolean(name) && NON_EXECUTOR_NAME_PATTERN.test(name);
};

/** Argument names that denote an executor being adapted (`quietProbe($)`). */
const EXECUTOR_ARGUMENT_PATTERN = /\$|exec|run|dollar|spawn/i;

const PLACEHOLDER = '__interpolated__';

const flattenTemplateLiteral = node => node.quasis.map(q => q.value.cooked ?? q.value.raw).join(PLACEHOLDER);

/** The static text of a string-ish node, or null when it is not statically known. */
const staticText = node => {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return flattenTemplateLiteral(node);
  return null;
};

/**
 * Leading static argv of an args node (`['api', x, '--paginate']` -> `['api', '__interpolated__', '--paginate']`).
 * Resolves an identifier to its `const` array initialiser. Returns null when unknown.
 */
const staticArgv = (node, scopeOf) => {
  if (!node) return null;
  if (node.type === 'Identifier') {
    const variable = findVariable(scopeOf(node), node.name);
    const def = variable?.defs?.[0];
    if (variable?.defs?.length === 1 && def?.type === 'Variable' && def.parent?.kind === 'const' && def.node.init?.type === 'ArrayExpression') return staticArgv(def.node.init, scopeOf);
    return null;
  }
  if (node.type !== 'ArrayExpression') return null;
  if (node.elements[0]?.type === 'SpreadElement') return null;
  const argv = [];
  for (const element of node.elements) {
    if (!element || element.type === 'SpreadElement') break;
    argv.push(staticText(element) ?? PLACEHOLDER);
  }
  return argv;
};

const findVariable = (scope, name) => {
  let current = scope;
  while (current) {
    const variable = current.set?.get(name) ?? current.variables.find(v => v.name === name);
    if (variable) return variable;
    current = current.upper;
  }
  return null;
};

/** Unwrap `$({ cwd })`, `$.raw`, `deps.exec` down to the node naming the executor. */
const executorBase = node => {
  let current = node;
  while (current?.type === 'CallExpression') current = current.callee;
  return current;
};

const calleeName = node => {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') return node.property.name;
  return null;
};

const exportSourceCache = new Map();

/**
 * Is `name`, imported from `source` (relative to `filename`), exported as a
 * value built by a wrap factory (`export const runCommand = wrapRunnerWithGitHubRetry(spawnCommand)`)?
 * Only relative imports of project files are followed; packages are not retrying.
 */
const importedBindingIsRetrying = (filename, source, name) => {
  if (!filename || typeof source !== 'string' || !source.startsWith('.')) return false;
  const path = resolve(dirname(filename), source);
  if (!exportSourceCache.has(path)) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      text = null;
    }
    exportSourceCache.set(path, text);
  }
  const text = exportSourceCache.get(path);
  if (!text) return false;
  const factories = [...WRAP_FACTORY_NAMES].join('|');
  return new RegExp(`export\\s+const\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*(?:${factories})\\(`).test(text);
};

const isFunctionNode = node => node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration');

/** Does `node`'s subtree call a retry helper or wrap factory? */
const containsRetryCall = (node, seen = new Set()) => {
  if (!node || typeof node !== 'object' || seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some(child => containsRetryCall(child, seen));
  if (node.type === 'CallExpression') {
    const name = calleeName(node.callee);
    if (name && (RETRY_HELPER_NAMES.has(name) || WRAP_FACTORY_NAMES.has(name))) return true;
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (child && typeof child === 'object' && (Array.isArray(child) || typeof child.type === 'string') && containsRetryCall(child, seen)) return true;
  }
  return false;
};

const isRetryHelperCall = node => node?.type === 'CallExpression' && RETRY_HELPER_NAMES.has(calleeName(node.callee));

/**
 * Build the analyser for one file.
 *
 * @param {import('eslint').Rule.RuleContext} context
 */
export const createGitHubOperationAnalyser = context => {
  const sourceCode = context.sourceCode || context.getSourceCode();
  const scopeOf = node => (sourceCode.getScope ? sourceCode.getScope(node) : context.getScope());

  /** Is the function node passed to a retry helper, directly or by name? */
  const functionRunsUnderRetry = fn => {
    if (isRetryHelperCall(fn.parent) && fn.parent.arguments.includes(fn)) return true;
    let variable = null;
    if (fn.type === 'FunctionDeclaration' && fn.id) variable = findVariable(scopeOf(fn), fn.id.name);
    else if (fn.parent?.type === 'VariableDeclarator' && fn.parent.init === fn && fn.parent.id.type === 'Identifier') variable = findVariable(scopeOf(fn.parent), fn.parent.id.name);
    if (!variable) return false;
    return variable.references.some(ref => isRetryHelperCall(ref.identifier.parent) && ref.identifier.parent.arguments.includes(ref.identifier));
  };

  const insideRetriedFunction = node => {
    for (let current = node.parent; current; current = current.parent) {
      if (isFunctionNode(current) && functionRunsUnderRetry(current)) return true;
    }
    return false;
  };

  /** Is the expression an executor that retries GitHub operations? */
  const expressionIsRetrying = (expr, seen) => {
    if (!expr) return false;
    if (expr.type === 'AwaitExpression') return expressionIsRetrying(expr.argument, seen);
    if (expr.type === 'CallExpression') {
      const name = calleeName(expr.callee);
      if (name && (WRAP_FACTORY_NAMES.has(name) || RETRY_HELPER_NAMES.has(name))) return true;
      // `$(QUIET_PROBE)` / `$({ cwd })` of a retrying `$` is still retrying.
      if (expressionIsRetrying(expr.callee, seen)) return true;
      // `quietProbe($)` / `withCwd(exec)`: an adapter handed a retrying executor
      // returns that executor with different options.
      return expr.arguments.some(arg => arg.type === 'Identifier' && EXECUTOR_ARGUMENT_PATTERN.test(arg.name) && identifierIsRetrying(arg, seen));
    }
    if (expr.type === 'Identifier') return identifierIsRetrying(expr, seen);
    if (isFunctionNode(expr)) return containsRetryCall(expr.body);
    if (expr.type === 'ConditionalExpression') return expressionIsRetrying(expr.consequent, seen) && expressionIsRetrying(expr.alternate, seen);
    if (expr.type === 'LogicalExpression') return expressionIsRetrying(expr.left, seen) && expressionIsRetrying(expr.right, seen);
    if (expr.type === 'MemberExpression') return SAFE_EXECUTOR_NAMES.has(calleeName(expr));
    return false;
  };

  /**
   * An identifier is retrying when every value written to its variable is a
   * retrying expression. Parameters, and values destructured off a parameter
   * or another object, come from the caller - who owns the wrapper.
   */
  const identifierIsRetrying = (identifier, seen = new Set()) => {
    if (SAFE_EXECUTOR_NAMES.has(identifier.name)) return true;
    const variable = findVariable(scopeOf(identifier), identifier.name);
    if (!variable || variable.defs.length === 0) return false; // a global
    if (seen.has(variable)) return false;
    seen.add(variable);
    const def = variable.defs[0];
    if (def.type === 'Parameter') {
      // `({ $ = rawDollar }) =>`: the default is ours to check; otherwise the caller's.
      const pattern = findPatternFor(def.name);
      return pattern?.type === 'AssignmentPattern' ? expressionIsRetrying(pattern.right, seen) : true;
    }
    if (def.type === 'FunctionName') return containsRetryCall(def.node.body) || callsRetryingExecutor(def.node.body, seen);
    if (def.type === 'ImportBinding') {
      const imported = def.node.type === 'ImportSpecifier' ? (def.node.imported?.name ?? def.node.imported?.value) : null;
      return Boolean(imported) && importedBindingIsRetrying(context.filename ?? context.getFilename?.(), def.parent?.source?.value, imported);
    }
    if (def.type !== 'Variable') return false;
    const declarator = def.node;
    if (declarator.id.type === 'ObjectPattern' || declarator.id.type === 'ArrayPattern') {
      const pattern = findPatternFor(def.name);
      if (pattern?.type === 'AssignmentPattern' && !expressionIsRetrying(pattern.right, seen)) return false;
      // `const { $ } = params` / `= options.deps`: handed in, not built here.
      const init = declarator.init;
      return Boolean(init) && (init.type === 'Identifier' ? isFromCaller(init, seen) : init.type === 'MemberExpression' || init.type === 'ThisExpression');
    }
    const writes = variable.references.filter(ref => ref.isWrite() && ref.writeExpr);
    if (writes.length === 0) return false;
    return writes.every(ref => expressionIsRetrying(ref.writeExpr, seen));
  };

  /**
   * `async function tryExecAsync(cmd, args) { ... await execFileAsync(cmd, args) ... }`
   * where `execFileAsync` is retrying: a local helper that starts its process
   * through a retrying runner is itself retrying.
   */
  const callsRetryingExecutor = (node, seen, visited = new Set()) => {
    if (!node || typeof node !== 'object' || visited.has(node)) return false;
    visited.add(node);
    if (Array.isArray(node)) return node.some(child => callsRetryingExecutor(child, seen, visited));
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && EXECUTOR_ARGUMENT_PATTERN.test(node.callee.name) && identifierIsRetrying(node.callee, seen)) return true;
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (child && typeof child === 'object' && (Array.isArray(child) || typeof child.type === 'string') && callsRetryingExecutor(child, seen, visited)) return true;
    }
    return false;
  };

  /** `const { $ } = params`: true when `params` is a parameter or itself destructured from the caller. */
  const isFromCaller = (identifier, seen) => {
    const variable = findVariable(scopeOf(identifier), identifier.name);
    const def = variable?.defs?.[0];
    if (!def) return false;
    if (def.type === 'Parameter') return true;
    if (def.type === 'Variable' && def.node.init?.type === 'Identifier' && !seen.has(variable)) {
      seen.add(variable);
      return isFromCaller(def.node.init, seen);
    }
    return def.type === 'Variable' && def.node.init?.type === 'MemberExpression';
  };

  /** The `x = default` pattern a binding sits in (`({ $ = rawDollar }) =>`), if any. */
  const findPatternFor = nameNode => (nameNode.parent?.type === 'AssignmentPattern' && nameNode.parent.left === nameNode ? nameNode.parent : null);

  const executorIsRetrying = node => {
    if (node?.type === 'CallExpression' && expressionIsRetrying(node, new Set())) return true;
    const base = executorBase(node);
    if (!base) return false;
    if (base.type === 'Identifier') return identifierIsRetrying(base);
    if (base.type === 'MemberExpression') {
      if (SAFE_EXECUTOR_NAMES.has(calleeName(base))) return true;
      if (calleeName(base) === 'raw') return false; // `$.raw` is the unwrapped tag
      // `deps.exec(...)`, `this.$\`...\``, `options.run(...)`: injected by the caller.
      let object = base.object;
      while (object?.type === 'MemberExpression') object = object.object;
      if (object?.type === 'ThisExpression') return true;
      if (object?.type === 'Identifier') {
        const variable = findVariable(scopeOf(object), object.name);
        const def = variable?.defs?.[0];
        if (!def) return false; // `child_process.execFile` on a global/unknown object
        if (def.type === 'Parameter') return true;
        if (def.type === 'ImportBinding') return false;
        return isFromCaller(object, new Set());
      }
    }
    return false;
  };

  const hasEscapeComment = node => {
    const line = node.loc.start.line;
    return sourceCode.getAllComments().some(comment => comment.value.includes(ESCAPE_COMMENT) && (comment.loc.end.line === line || comment.loc.end.line === line - 1 || (comment.loc.start.line <= line && comment.loc.end.line >= line)));
  };

  /**
   * The GitHub operation a call/tagged template starts, or null.
   * @returns {{ tool: 'gh'|'git', label: string, executor: import('estree').Node }|null}
   */
  const operationOf = node => {
    if (node.type === 'TaggedTemplateExpression') {
      const operation = classifyGitHubCommand(flattenTemplateLiteral(node.quasi));
      return operation && { ...operation, executor: node.tag };
    }
    if (node.type !== 'CallExpression' || isNonExecutorCallee(node.callee)) return null;
    const args = node.arguments || [];
    // Shell-string style: exec('gh api ...'), execSync(`git push ...`).
    const first = staticText(args[0]);
    if (first !== null && /\s/.test(first.trim())) {
      const operation = classifyGitHubCommand(first);
      return operation && { ...operation, executor: node.callee };
    }
    // argv style: execFile('gh', [...]), spawn('git', ['push']), run(runner, 'gh', args).
    for (let i = 0; i < args.length; i++) {
      const tool = staticText(args[i]);
      if (tool !== 'gh' && tool !== 'git') continue;
      const argv = staticArgv(args[i + 1], scopeOf);
      if (argv === null) {
        // Unknown argv: every gh subcommand but a handful is an API call; for
        // git we cannot tell a push from a status, so only `gh` is assumed.
        if (tool === 'gh' && args[i + 1]) return { tool, label: 'gh', executor: node.callee };
        return null;
      }
      const operation = classifyGitHubCommand(tool, argv);
      return operation && { ...operation, executor: node.callee };
    }
    return null;
  };

  /**
   * @returns {{ tool: 'gh'|'git', label: string }|null} the unretried operation at `node`, if any.
   */
  const unretriedOperation = node => {
    const operation = operationOf(node);
    if (!operation) return null;
    if (executorIsRetrying(operation.executor)) return null;
    // `commandOutput(run, 'gh', args)`: the runner that starts the process is an argument.
    if (node.type === 'CallExpression' && node.arguments.some(arg => arg.type === 'Identifier' && EXECUTOR_ARGUMENT_PATTERN.test(arg.name) && identifierIsRetrying(arg))) return null;
    if (insideRetriedFunction(node)) return null;
    if (hasEscapeComment(node)) return null;
    return operation;
  };

  return { operationOf, unretriedOperation };
};

export const _testing = { flattenTemplateLiteral, staticText, containsRetryCall };
