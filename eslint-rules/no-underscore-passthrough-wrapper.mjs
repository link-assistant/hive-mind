/**
 * ESLint rule to detect thin wrapper functions that just call an underscore-prefixed import.
 *
 * This pattern arises when a function is extracted to a library file and imported with an
 * underscore prefix (e.g., `import { foo as _foo }`), then a wrapper is created that simply
 * calls the imported function:
 *
 *   function foo(...args) {
 *     return _foo(...args);  // <-- thin wrapper, adds no value
 *   }
 *
 * If the wrapper adds no additional arguments or logic beyond what the call site could
 * provide directly, it should be removed in favor of calling the underscore-prefixed
 * function directly.
 *
 * Note: Wrappers that partially apply arguments (binding context-specific values) are
 * intentional and useful — this rule only flags functions where the wrapper body is a
 * single return statement calling the underscore function with the exact same parameters
 * (i.e., no extra/partial arguments are added by the wrapper).
 */

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow thin wrapper functions that only call an underscore-prefixed imported function with the same arguments',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noPassthroughWrapper: 'Function "{{name}}" is a thin passthrough wrapper for "_{{name}}". ' + 'Call "_{{name}}" directly at the call site instead of creating a wrapper.',
    },
    schema: [],
  },

  create(context) {
    // Collect all underscore-prefixed imports: _foo -> true
    const underscoreImports = new Set();

    return {
      // Track underscore-prefixed imports (both static and dynamic destructuring)
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.local.name.startsWith('_')) {
            underscoreImports.add(specifier.local.name);
          }
        }
      },

      // Also track dynamic import destructuring: const { foo: _foo } = await import(...)
      VariableDeclarator(node) {
        if (node.id && node.id.type === 'ObjectPattern' && node.init && node.init.type === 'AwaitExpression' && node.init.argument && node.init.argument.type === 'ImportExpression') {
          for (const prop of node.id.properties) {
            if (prop.type === 'Property' && prop.value && prop.value.type === 'Identifier' && prop.value.name.startsWith('_')) {
              underscoreImports.add(prop.value.name);
            }
          }
        }
      },

      // Check function declarations: function foo(a, b) { return _foo(a, b); }
      FunctionDeclaration(node) {
        checkWrapperFunction(node, context, underscoreImports);
      },

      // Check arrow function expressions assigned to variables: const foo = (a, b) => _foo(a, b);
      // or: const foo = (a, b) => { return _foo(a, b); };
      VariableDeclaration(node) {
        for (const declarator of node.declarations) {
          if (declarator.id && declarator.id.type === 'Identifier' && declarator.init && (declarator.init.type === 'ArrowFunctionExpression' || declarator.init.type === 'FunctionExpression')) {
            checkWrapperFunction({ ...declarator.init, id: declarator.id }, context, underscoreImports);
          }
        }
      },
    };
  },
};

/**
 * Check if a function node is a thin passthrough wrapper for an underscore-prefixed function.
 *
 * A passthrough wrapper is detected when:
 * 1. The function name is `foo` and there is an underscore import `_foo`
 * 2. The function body has exactly one statement: `return _foo(...sameParams)`
 * 3. The call to `_foo` uses exactly the same parameters as the wrapper (no extra partial args)
 */
function checkWrapperFunction(node, context, underscoreImports) {
  const name = node.id && node.id.name;
  if (!name) return;

  // Check if a corresponding _name import exists
  const underscoreName = `_${name}`;
  if (!underscoreImports.has(underscoreName)) return;

  // Get the function body's single return statement
  const body = node.body;
  let returnedCall = null;

  if (body.type === 'BlockStatement') {
    // Filter out empty statements
    const stmts = body.body.filter(s => s.type !== 'EmptyStatement');
    if (stmts.length !== 1) return;
    const stmt = stmts[0];
    if (stmt.type !== 'ReturnStatement' || !stmt.argument) return;
    returnedCall = stmt.argument;
  } else {
    // Arrow function with expression body: (a) => _foo(a)
    returnedCall = body;
  }

  // The returned expression must be a call to the underscore function
  if (!returnedCall || returnedCall.type !== 'CallExpression' || returnedCall.callee.type !== 'Identifier' || returnedCall.callee.name !== underscoreName) {
    return;
  }

  // Check if the call uses the exact same parameters (passthrough) and nothing extra
  const params = node.params || [];
  const callArgs = returnedCall.arguments || [];

  // If the wrapper adds MORE arguments than its params (partial application), it's intentional
  // e.g., function foo(text) { return _foo(text, { extra: context }); }
  // Only flag when call args count exactly matches param count (pure passthrough)
  if (callArgs.length !== params.length) return;

  // Check that each argument in the call matches the corresponding parameter name
  const isPassthrough = params.every((param, i) => {
    const arg = callArgs[i];
    return param.type === 'Identifier' && arg.type === 'Identifier' && param.name === arg.name;
  });

  if (!isPassthrough) return;

  context.report({
    node: node.id || node,
    messageId: 'noPassthroughWrapper',
    data: { name },
  });
}
