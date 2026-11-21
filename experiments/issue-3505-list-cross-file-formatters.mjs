// Issue #3505: list imported functions whose result reaches a Telegram
// safe-send call in another module (candidates for `@telegram-markdown`).
// Usage: node experiments/issue-3505-list-cross-file-formatters.mjs
import { ESLint } from 'eslint';

const found = new Map();
const rule = {
  create(context) {
    const imports = new Map();
    const calls = [];
    return {
      ImportSpecifier(node) {
        imports.set(node.local.name, { name: node.imported.name, from: node.parent.source.value });
      },
      CallExpression(node) {
        calls.push(node);
      },
      'Program:exit'() {
        const sinks = { safeReply: 1, safeSendMessage: 2, safeEditMessageText: 4 };
        const visit = (expression, depth = 0) => {
          if (!expression || depth > 6) return;
          if (expression.type === 'CallExpression' && expression.callee.type === 'Identifier' && imports.has(expression.callee.name)) {
            const { name, from } = imports.get(expression.callee.name);
            const key = `${from}#${name}`;
            if (!found.has(key)) found.set(key, new Set());
            found.get(key).add(context.filename.replace(`${process.cwd()}/`, ''));
          }
          if (expression.type === 'TemplateLiteral') expression.expressions.forEach(e => visit(e, depth + 1));
          if (expression.type === 'ConditionalExpression') [expression.consequent, expression.alternate].forEach(e => visit(e, depth + 1));
          if (expression.type === 'LogicalExpression' || expression.type === 'BinaryExpression') [expression.left, expression.right].forEach(e => visit(e, depth + 1));
          if (expression.type === 'AwaitExpression') visit(expression.argument, depth + 1);
          if (expression.type === 'Identifier') {
            for (let scope = context.sourceCode.getScope(expression); scope; scope = scope.upper) {
              const variable = scope.set.get(expression.name);
              if (!variable) continue;
              for (const def of variable.defs) if (def.type === 'Variable' && def.node.init) visit(def.node.init, depth + 1);
              for (const ref of variable.references) if (ref.identifier.parent?.type === 'AssignmentExpression' && ref.identifier.parent.left === ref.identifier) visit(ref.identifier.parent.right, depth + 1);
              break;
            }
          }
        };
        for (const call of calls) {
          const index = call.callee.type === 'Identifier' ? sinks[call.callee.name] : undefined;
          if (index !== undefined) visit(call.arguments[index]);
        }
      },
    };
  },
};
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ files: ['**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module' }, plugins: { x: { rules: { r: rule } } }, rules: { 'x/r': 'error' } }] });
await eslint.lintFiles(['src/**/*.mjs']);
for (const [key, files] of [...found].sort()) console.log(`${key}  <=  ${[...files].join(', ')}`);
