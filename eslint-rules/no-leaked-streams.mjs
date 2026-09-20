/**
 * ESLint rule to prevent event loop leaks from unclosed stream handles.
 *
 * Motivation (Issue #1431): Node.js streams (ReadStream, WriteStream) keep the
 * event loop alive until they are explicitly closed or destroyed. If a stream is
 * created but its return value is discarded, there is no way to call .destroy()
 * or .end() on it later — the handle leaks and can hang the process indefinitely.
 *
 * ## What this rule flags
 *
 * 1. **Bare statement-level stream creation** — `fs.createReadStream(path);` or
 *    `createWriteStream(path);` as a standalone ExpressionStatement. The return
 *    value is discarded so the stream can never be closed.
 *
 *    Pattern:
 *      fs.createReadStream('file.txt');           // ❌ return value not captured
 *      createWriteStream('/tmp/out.log');          // ❌ return value not captured
 *
 * ## What this rule ALLOWS (not flagged)
 *
 *   const rs = fs.createReadStream('file.txt');  // ✅ captured → can be .destroy()'d
 *   let ws; ws = fs.createWriteStream('out');    // ✅ captured → can be .end()'d
 *   return fs.createReadStream(path);            // ✅ returned to caller
 *   pipe(fs.createReadStream(path));             // ✅ passed to pipe → ownership transferred
 *
 * ## Background
 *
 * This rule is the stream companion to `no-leaked-timers` (Issue #1346). Both rules
 * enforce the same principle: if you create a resource that keeps the event loop alive,
 * you must hold a reference to it so you can clean it up.
 *
 * Known handle types addressed:
 *   - fs.ReadStream  (fd, path)  — created by fs.createReadStream()
 *   - fs.WriteStream (fd, path)  — created by fs.createWriteStream()
 */

const STREAM_FUNCTIONS = new Set(['createReadStream', 'createWriteStream']);

/**
 * Returns true if the CallExpression's return value is captured or used.
 */
function isUsed(callNode) {
  const parent = callNode.parent;
  if (!parent) return false;

  // const rs = createReadStream(...)  →  VariableDeclarator
  if (parent.type === 'VariableDeclarator' && parent.init === callNode) return true;

  // rs = createReadStream(...)  →  AssignmentExpression
  if (parent.type === 'AssignmentExpression' && parent.right === callNode) return true;

  // return createReadStream(...)  →  ReturnStatement
  if (parent.type === 'ReturnStatement') return true;

  // yield createReadStream(...)  →  YieldExpression
  if (parent.type === 'YieldExpression') return true;

  // await createReadStream(...) is unusual but if awaited it is used
  if (parent.type === 'AwaitExpression') return true;

  // Passed as an argument: pipe(createReadStream(...)), createInterface({input: createReadStream(...)})
  if (parent.type === 'CallExpression' || parent.type === 'NewExpression') return true;

  // Part of a larger expression: obj.stream = createReadStream(...)
  if (parent.type === 'MemberExpression') return true;

  // Part of object/array literal: { stream: createReadStream(...) }
  if (parent.type === 'Property' && parent.value === callNode) return true;
  if (parent.type === 'ArrayExpression') return true;

  // Ternary / logical: x ? createReadStream() : y
  if (parent.type === 'ConditionalExpression') return true;
  if (parent.type === 'LogicalExpression') return true;

  return false;
}

/**
 * Returns true if the CallExpression is a member call on an object
 * that matches one of the stream function names (e.g. fs.createReadStream).
 */
function isStreamCall(node) {
  const callee = node.callee;
  if (!callee) return false;

  // Direct call: createReadStream(...)
  if (callee.type === 'Identifier' && STREAM_FUNCTIONS.has(callee.name)) return true;

  // Member call: fs.createReadStream(...), promises.createReadStream(...)
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && STREAM_FUNCTIONS.has(callee.property.name)) {
    return true;
  }

  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent event loop leaks from unclosed stream handles: flag bare createReadStream/createWriteStream calls whose return value is not captured',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      bareStream: '"{{name}}()" return value is not captured — the stream can never be closed. Assign to a variable and call .destroy() (ReadStream) or .end() / .destroy() (WriteStream) when done to prevent event loop leaks (see issue #1431).',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isStreamCall(node)) return;
        if (isUsed(node)) return;

        // Only flag bare ExpressionStatement (result completely discarded)
        if (node.parent && node.parent.type === 'ExpressionStatement') {
          const name = node.callee.type === 'MemberExpression' ? `${node.callee.object.name ?? ''}.${node.callee.property.name}` : node.callee.name;

          context.report({
            node,
            messageId: 'bareStream',
            data: { name },
          });
        }
      },
    };
  },
};
