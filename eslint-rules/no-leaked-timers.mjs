/**
 * ESLint rule to prevent event loop leaks from uncleaned timer handles.
 *
 * Motivation (Issue #1346): A floating `setTimeout(reject, 60000)` inside a
 * `Promise.race` loser branch kept the Node.js event loop alive for 60 extra
 * seconds per poll iteration, causing `solve` to hang after the PR was merged.
 *
 * ## What this rule flags
 *
 * 1. **Bare statement-level calls** — `setTimeout(fn, ms);` as a standalone
 *    ExpressionStatement.  The return value is discarded entirely so the timer
 *    can never be cleared.
 *
 * 2. **Reject-timers inside `Promise.race` timeout arms** — the most
 *    dangerous pattern.  When `Promise.race` resolves on the *other* branch,
 *    the rejection timer is still pending and keeps the event loop alive.
 *    If the race is inside a loop (as in waitForCI) a new uncleaned timer
 *    is spawned every iteration.
 *
 *    Pattern:
 *      new Promise((_, reject) => { setTimeout(reject, ms) })
 *      new Promise((_, reject) => { setTimeout(() => reject(new Error()), ms) })
 *
 * ## What this rule ALLOWS (not flagged)
 *
 *   const id = setTimeout(fn, ms);                     // captured → OK
 *   let id; id = setTimeout(fn, ms);                   // captured → OK
 *   clearTimeout(setTimeout(fn, ms));                  // immediately cleared → OK
 *   new Promise(resolve => setTimeout(resolve, ms))    // resolve-only arm → OK
 *      ↑ timer fires once, resolves the Promise, then is GC'd naturally
 */

const TIMER_FUNCTIONS = new Set(['setTimeout', 'setInterval']);

/**
 * Returns true if the CallExpression's return value is captured.
 */
function isAssigned(callNode) {
  const parent = callNode.parent;
  if (!parent) return false;
  // const id = setTimeout(...)  →  VariableDeclarator
  if (parent.type === 'VariableDeclarator' && parent.init === callNode) return true;
  // id = setTimeout(...)  →  AssignmentExpression
  if (parent.type === 'AssignmentExpression' && parent.right === callNode) return true;
  // clearTimeout(setTimeout(...))  →  argument to clear function
  if (parent.type === 'CallExpression') {
    const callee = parent.callee;
    if (callee.type === 'Identifier' && (callee.name === 'clearTimeout' || callee.name === 'clearInterval')) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the CallExpression is a direct ExpressionStatement —
 * i.e. the result is completely discarded at statement level.
 */
function isExpressionStatement(callNode) {
  return callNode.parent && callNode.parent.type === 'ExpressionStatement';
}

/**
 * Returns true if this setTimeout/setInterval call is inside a
 * `new Promise(executor)` constructor AND the callback passed to the timer
 * invokes the `reject` parameter of the executor (not just `resolve`).
 *
 * These are the dangerous cases: when the other branch of Promise.race wins,
 * the reject timer is still pending and keeps the event loop alive.
 *
 * Flagged patterns:
 *   new Promise((resolve, reject) => { setTimeout(reject, ms) })
 *   new Promise((_, reject) => { setTimeout(() => reject(new Error()), ms) })
 *
 * Not flagged (resolve-only):
 *   new Promise(resolve => { setTimeout(resolve, ms) })
 *   new Promise((resolve) => { setTimeout(resolve, ms) })
 */
function isRejectTimerInPromise(callNode) {
  // Walk up to find the enclosing new Promise(executor) node
  let node = callNode.parent;
  let executorNode = null;

  while (node) {
    if (node.type === 'NewExpression' && node.callee && node.callee.type === 'Identifier' && node.callee.name === 'Promise' && node.arguments.length >= 1) {
      executorNode = node.arguments[0];
      break;
    }
    node = node.parent;
  }

  if (!executorNode) return false;

  // Get the executor parameters: (resolve, reject) or (_, reject) etc.
  const params = executorNode.params || [];
  if (params.length < 2) return false; // only a resolve param — no reject

  const rejectParam = params[1];
  if (!rejectParam || rejectParam.type !== 'Identifier') return false;
  const rejectName = rejectParam.name;

  // Check if the first argument to setTimeout invokes reject:
  const timerCallback = callNode.arguments[0];
  if (!timerCallback) return false;

  // Case 1: setTimeout(reject, ms) — direct reference to reject param
  if (timerCallback.type === 'Identifier' && timerCallback.name === rejectName) {
    return true;
  }

  // Case 2: setTimeout(() => reject(...), ms) or setTimeout(() => { reject(...); }, ms)
  if (timerCallback.type === 'ArrowFunctionExpression' || timerCallback.type === 'FunctionExpression') {
    return bodyCallsIdentifier(timerCallback.body, rejectName);
  }

  return false;
}

/**
 * Recursively checks whether a function body AST node contains a call to
 * the identifier with the given `name`.
 */
function bodyCallsIdentifier(node, name) {
  if (!node) return false;
  if (node.type === 'CallExpression') {
    if (node.callee.type === 'Identifier' && node.callee.name === name) return true;
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === 'string' && bodyCallsIdentifier(item, name)) return true;
        }
      } else if (typeof child.type === 'string') {
        if (bodyCallsIdentifier(child, name)) return true;
      }
    }
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent event loop leaks from uncleaned timer handles: flag bare setTimeout/setInterval statements and reject-timers inside Promise constructors',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      bareTimer: '"{{name}}()" return value is not captured — the timer can never be cleared. Assign to a variable and call clearTimeout/clearInterval when done to prevent event loop leaks (see issue #1346).',
      rejectTimerInPromise: '"{{name}}()" creates a reject-timer inside a Promise constructor whose return value is not captured. If Promise.race resolves on the other branch first, this timer stays alive indefinitely. Capture the timer ID and add ".finally(() => clearTimeout(id))" on the enclosing Promise.race() (see issue #1346).',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !TIMER_FUNCTIONS.has(node.callee.name)) {
          return;
        }

        // If already captured, nothing to flag
        if (isAssigned(node)) {
          return;
        }

        // Case 1: bare statement-level call — result is thrown away entirely
        if (isExpressionStatement(node)) {
          context.report({
            node,
            messageId: 'bareTimer',
            data: { name: node.callee.name },
          });
          return;
        }

        // Case 2: reject-timer inside a Promise constructor (the issue #1346 root cause pattern)
        if (isRejectTimerInPromise(node)) {
          context.report({
            node,
            messageId: 'rejectTimerInPromise',
            data: { name: node.callee.name },
          });
        }
      },
    };
  },
};
