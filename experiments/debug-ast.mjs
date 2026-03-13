import { Linter } from '/tmp/gh-issue-solver-1773386307025/node_modules/eslint/lib/linter/linter.js';

const code = `
const { foo: _foo } = await import('./lib.mjs');
function foo(x) {
  return _foo(x);
}
`;

const linter = new Linter({ configType: 'flat' });
const config = [
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    plugins: {
      debug: {
        rules: {
          'log-nodes': {
            meta: { type: 'suggestion', schema: [] },
            create(ctx) {
              return {
                VariableDeclarator(node) {
                  console.log('VariableDeclarator init type:', node.init?.type);
                  console.log('VariableDeclarator init:', JSON.stringify(node.init, null, 2).slice(0, 600));
                },
              };
            },
          },
        },
      },
    },
    rules: { 'debug/log-nodes': 'warn' },
  },
];

linter.verify(code, config);
