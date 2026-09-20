# use-m Library Issues

This directory contains reproducible test cases for issues encountered with the use-m library when dynamically importing npm packages.

## Issues Documented

1. **issue-01-subpath-imports.mjs** - Subpath imports like `package/submodule` fail with @latest tag
2. **issue-02-module-format-detection.mjs** - Inconsistent module format detection between @latest and specific versions
3. **issue-03-eval-context.mjs** - use-m fails when modules are imported via `node -e` (eval context)

## Critical Issues

⚠️ **Issue #1 - Subpath Import Failures**: The pattern `package@latest/subpath` fails to resolve, while `package@version/subpath` works. This breaks common patterns like `yargs@latest/helpers` for accessing hideBin. Must use specific version numbers as workaround.

⚠️ **Issue #2 - Module Format Inconsistency**: The same package returns different module formats when using @latest vs specific version. For example, `yargs@latest` requires `.default` access, while `yargs@17.7.2` may not. This causes runtime errors when switching between version tags.

⚠️ **Issue #3 - Eval Context Failures**: use-m fails when modules are imported via `node -e` or any eval context. The error `ERR_INVALID_ARG_VALUE` occurs because Module.createRequire() rejects '[eval]' as an invalid filename. This breaks GitHub Actions tests and REPL imports.

## Running the Tests

Each issue can be tested independently:

```bash
# With Node.js
node ./issue-01-subpath-imports.mjs

# With Bun
bun ./issue-01-subpath-imports.mjs

# Run all tests
for script in issue-*.mjs; do echo "=== $script ==="; node "$script"; done
```

## Workarounds and Best Practices

### 1. Subpath Imports

```javascript
// DON'T: This fails with @latest
const { hideBin } = await use('yargs@latest/helpers');

// DO: Use specific version
const { hideBin } = await use('yargs@17.7.2/helpers');

// OR: Handle the error gracefully
let hideBin;
try {
  const helpers = await use('yargs@17.7.2/helpers');
  hideBin = helpers.hideBin;
} catch (e) {
  // Fallback implementation
  hideBin = argv => argv.slice(2);
}
```

### 2. Module Format Detection

```javascript
// DON'T: Assume module format
const yargs = await use('yargs@latest');

// DO: Handle both cases
const yargsModule = await use('yargs@latest');
const yargs = yargsModule.default || yargsModule;

// For packages that might change:
const moduleImport = await use('package-name');
const module = moduleImport.default || moduleImport;
```

### 3. Eval Context Handling

```javascript
// DON'T: Test imports with node -e
node -e "import('./lib.mjs').then(() => console.log('OK'))"

// DO: Create actual test files
// test-lib.mjs
import './lib.mjs';
console.log('OK');

// OR: Add fallback for eval context in library
let fs;
try {
  if (typeof use === 'undefined') {
    globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
  }
  fs = (await use('fs')).promises;
} catch (error) {
  // Fallback for eval context
  const fsModule = await import('fs');
  fs = fsModule.promises;
}
```

### 4. Conditional Loading

```javascript
// Pattern for modules that might already be loaded
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
```

### 5. Cross-Runtime Compatibility

```javascript
// Shebang for both Node and Bun
#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"
```

## Impact on Development

These issues affect:

- Module reusability across projects
- Consistency in import patterns
- Runtime reliability when versions change
- Development speed due to trial-and-error debugging

## Recommendations for use-m Library

1. **Fix subpath resolution** for @latest tags to match npm's behavior
2. **Standardize module format** detection regardless of version tag
3. **Improve error messages** to indicate why imports fail
4. **Document limitations** clearly in the README
5. **Add configuration options** for module resolution behavior
6. **Provide helper functions** for common patterns like default export unwrapping

## Alternative Approaches

If use-m issues become blockers:

1. Use specific versions instead of @latest
2. Create wrapper modules that handle imports
3. Use traditional package.json with npm/yarn/bun
4. Consider other dynamic import solutions

## Conclusion

While use-m provides elegant package-free imports, these issues require defensive coding patterns and workarounds. The library would benefit from more consistent behavior and better handling of modern npm package patterns.
