/**
 * Experiment: Verify the no-underscore-passthrough-wrapper ESLint rule catches the bad pattern.
 */
import { Linter } from '/tmp/gh-issue-solver-1773386307025/node_modules/eslint/lib/linter/linter.js';
import rule from '/tmp/gh-issue-solver-1773386307025/eslint-rules/no-underscore-passthrough-wrapper.mjs';

const linter = new Linter({ configType: 'flat' });

// Test 1: Should flag - pure passthrough with static import
const code1 = `
import { foo as _foo } from './lib.mjs';
function foo(a, b) {
  return _foo(a, b);
}
`;

// Test 2: Should NOT flag - wrapper adds extra args (partial application)
const code2 = `
import { foo as _foo } from './lib.mjs';
function foo(a) {
  return _foo(a, { extra: 'context' });
}
`;

// Test 3: Should NOT flag - dynamic import, wrapper adds extra args
const code3 = `
const { extractGitHubUrl: _extractGitHubUrl } = await import('./lib.mjs');
function extractGitHubUrl(text) {
  return _extractGitHubUrl(text, { parseGitHubUrl, cleanNonPrintableChars });
}
`;

// Test 4: Should flag - pure passthrough with dynamic import
const code4 = `
const { foo: _foo } = await import('./lib.mjs');
function foo(x) {
  return _foo(x);
}
`;

const config = [
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    plugins: {
      test: { rules: { 'no-underscore-passthrough-wrapper': rule } },
    },
    rules: { 'test/no-underscore-passthrough-wrapper': 'error' },
  },
];

function test(name, code, expectViolation) {
  const messages = linter.verify(code, config);
  const hasViolation = messages.some(m => m.ruleId === 'test/no-underscore-passthrough-wrapper');
  const passed = hasViolation === expectViolation;
  console.log(`${passed ? '✅' : '❌'} ${name}: ${hasViolation ? 'violation found' : 'no violation'} (expected: ${expectViolation ? 'violation' : 'no violation'})`);
  if (!passed) {
    console.log('  Messages:', messages);
  }
}

test('static import passthrough', code1, true);
test('wrapper adds extra args (partial application)', code2, false);
test('dynamic import with extra args (real code pattern)', code3, false);
test('dynamic import pure passthrough', code4, true);

console.log('\nDone.');
