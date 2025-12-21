#!/usr/bin/env node
/**
 * Issue #3: use-m fails in eval context (node -e)
 *
 * Problem: When modules using use-m are imported via `node -e`, they fail with:
 * TypeError [ERR_INVALID_ARG_VALUE]: The argument 'filename' must be a file URL object,
 * file URL string, or absolute path string. Received '[eval]'
 *
 * This affects testing and any scenarios where modules are imported from eval context.
 */

console.log('=== Issue #3: Eval Context Failure ===\n');

// Test 1: Direct use-m in eval context
console.log('Test 1: Running use-m directly in eval context');
console.log(
  "Command: node -e \"globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use; await use('fs')\""
);
console.log('Expected: Fails with ERR_INVALID_ARG_VALUE');
console.log('');

// Test 2: Import module that uses use-m via eval
console.log('Test 2: Import module using use-m via node -e');
console.log("Command: node -e \"import('./lib.mjs').then(() => console.log('Success'))\"");
console.log('Expected: Fails when lib.mjs tries to initialize use-m');
console.log('');

// Test 3: Normal import (should work)
console.log('Test 3: Normal import from file');
try {
  // This would work in a real file context
  if (typeof use === 'undefined') {
    console.log('Attempting to load use-m in file context...');
    globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
    const fs = await use('fs');
    console.log('✅ Success: use-m works in file context');
  }
} catch (error) {
  console.log('❌ Error:', error.message);
}
console.log('');

// Demonstrate the problem
console.log('=== Root Cause ===');
console.log('1. use-m internally calls Module.createRequire(filename)');
console.log('2. In eval context, filename is "[eval]" not a valid file path');
console.log('3. Module.createRequire rejects "[eval]" as invalid');
console.log('');

console.log('=== Affected Scenarios ===');
console.log('- GitHub Actions tests using: node -e "import(\'./module.mjs\')"');
console.log('- REPL imports of modules using use-m');
console.log('- Any eval-based module loading');
console.log('');

console.log('=== Workarounds ===');
console.log('1. Never test imports with node -e');
console.log('2. Create actual test files instead of eval');
console.log('3. Add fallback to direct imports when use-m fails:');
console.log('');
console.log(`let fs;
try {
  if (typeof use === 'undefined') {
    globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
  }
  fs = (await use('fs')).promises;
} catch (error) {
  // Fallback for eval context
  const fsModule = await import('fs');
  fs = fsModule.promises;
}`);
console.log('');

console.log('=== Recommendation ===');
console.log('use-m should detect eval context and handle it gracefully.');
console.log('Check if filename === "[eval]" and use alternative loading strategy.');
