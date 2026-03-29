/**
 * ESLint rule to prevent event loop leaks from uncleaned child process handles.
 *
 * Motivation (Issue #1493): Node.js ChildProcess handles keep the event loop alive
 * until the child exits and all stdio pipes are closed. If a child process is spawned
 * but its return value is discarded, there is no way to call .kill() or listen for
 * 'close'/'exit' events — the handle leaks and can hang the process or leave orphans.
 *
 * ## What this rule flags
 *
 * 1. **Bare statement-level spawn/fork calls** — `spawn('ls');` or `fork('./worker.js');`
 *    as a standalone ExpressionStatement. The return value is discarded so the process
 *    can never be killed or monitored.
 *
 *    Pattern:
 *      spawn('ls', ['-la']);                    // ❌ return value not captured
 *      child_process.spawn('node', ['app']);    // ❌ return value not captured
 *      fork('./worker.js');                     // ❌ return value not captured
 *      execFile('git', ['status']);             // ❌ return value not captured
 *
 * ## What this rule ALLOWS (not flagged)
 *
 *   const child = spawn('ls', ['-la']);        // ✅ captured → can be .kill()'d
 *   let proc; proc = spawn('node', ['app']);   // ✅ captured → can listen for events
 *   return fork('./worker.js');                // ✅ returned to caller
 *   await exec('git status');                  // ✅ exec() awaited (promisified)
 *   doSomething(spawn('ls'));                  // ✅ passed as argument
 *
 * ## Background
 *
 * This rule is the child-process companion to `no-leaked-timers` (Issue #1346) and
 * `no-leaked-streams` (Issue #1431). All three enforce the same principle: if you
 * create a resource that keeps the event loop alive, you must hold a reference to it
 * so you can clean it up.
 *
 * Known handle types addressed:
 *   - ChildProcess (pid, spawnfile) — created by spawn(), fork(), execFile()
 */

const SPAWN_FUNCTIONS = new Set(['spawn', 'fork', 'execFile']);

/**
 * Returns true if the CallExpression's return value is captured or used.
 */
function isUsed(callNode) {
  const parent = callNode.parent;
  if (!parent) return false;

  // const child = spawn(...)  →  VariableDeclarator
  if (parent.type === 'VariableDeclarator' && parent.init === callNode) return true;

  // child = spawn(...)  →  AssignmentExpression
  if (parent.type === 'AssignmentExpression' && parent.right === callNode) return true;

  // return spawn(...)  →  ReturnStatement
  if (parent.type === 'ReturnStatement') return true;

  // yield spawn(...)  →  YieldExpression
  if (parent.type === 'YieldExpression') return true;

  // await spawn(...) — unusual but captured
  if (parent.type === 'AwaitExpression') return true;

  // Passed as an argument: doSomething(spawn(...))
  if (parent.type === 'CallExpression' || parent.type === 'NewExpression') return true;

  // Part of member expression: spawn(...).on(...)
  if (parent.type === 'MemberExpression') return true;

  // Part of object/array literal: { proc: spawn(...) }
  if (parent.type === 'Property' && parent.value === callNode) return true;
  if (parent.type === 'ArrayExpression') return true;

  // Ternary / logical: x ? spawn(...) : y
  if (parent.type === 'ConditionalExpression') return true;
  if (parent.type === 'LogicalExpression') return true;

  return false;
}

/**
 * Returns true if the CallExpression calls one of the spawn-like functions.
 */
function isSpawnCall(node) {
  const callee = node.callee;
  if (!callee) return false;

  // Direct call: spawn(...)
  if (callee.type === 'Identifier' && SPAWN_FUNCTIONS.has(callee.name)) return true;

  // Member call: child_process.spawn(...), childProcess.spawn(...)
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && SPAWN_FUNCTIONS.has(callee.property.name)) {
    return true;
  }

  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent event loop leaks from uncleaned child process handles: flag bare spawn/fork/execFile calls whose return value is not captured',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      bareSpawn:
        '"{{name}}()" return value is not captured — the child process can never be killed or monitored. Assign to a variable and call .kill() or listen for \'close\'/\'exit\' events when done to prevent event loop leaks and orphaned processes (see issue #1493).',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isSpawnCall(node)) return;
        if (isUsed(node)) return;

        // Only flag bare ExpressionStatement (result completely discarded)
        if (node.parent && node.parent.type === 'ExpressionStatement') {
          const name =
            node.callee.type === 'MemberExpression'
              ? `${node.callee.object.name ?? ''}.${node.callee.property.name}`
              : node.callee.name;

          context.report({
            node,
            messageId: 'bareSpawn',
            data: { name },
          });
        }
      },
    };
  },
};
