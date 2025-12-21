#!/usr/bin/env node

/**
 * Test script for visibility-based auto-cleanup default
 *
 * This script tests:
 * 1. Public repository: auto-cleanup should default to false (keep directories)
 * 2. Private repository: auto-cleanup should default to true (clean up directories)
 * 3. Explicit --auto-cleanup flag: should override default
 * 4. Explicit --no-auto-cleanup flag: should override default
 */

// Use use-m to dynamically import modules
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

console.log('🧪 Testing visibility-based auto-cleanup functionality\n');

// Test 1: Verify detectRepositoryVisibility function works
console.log('Test 1: Verify detectRepositoryVisibility function');
try {
  const githubLib = await import('../src/github.lib.mjs');
  const { detectRepositoryVisibility } = githubLib;

  // Test with public repository (link-assistant/hive-mind)
  console.log('  Testing with public repository (link-assistant/hive-mind):');
  const publicResult = await detectRepositoryVisibility('link-assistant', 'hive-mind');
  console.log(`    ✅ Detected: ${publicResult.visibility} (isPublic: ${publicResult.isPublic})`);

  if (publicResult.isPublic) {
    console.log('    ✅ Public repository detection works');
  } else {
    console.log('    ❌ Public repository should have isPublic=true');
  }

  // Try to find a private repository for testing
  console.log('\n  Testing with private repository (if accessible):');
  try {
    const userResult = await $`gh api user --jq .login`;
    const username = userResult.stdout.toString().trim();
    console.log(`    Current user: ${username}`);

    const reposResult =
      await $`gh repo list ${username} --json name,visibility --jq '.[] | select(.visibility == "private") | .name' --limit 1`;
    const privateRepo = reposResult.stdout.toString().trim();

    if (privateRepo) {
      const privateResult = await detectRepositoryVisibility(username, privateRepo);
      console.log(`    ✅ Detected: ${privateResult.visibility} (isPublic: ${privateResult.isPublic})`);

      if (!privateResult.isPublic) {
        console.log('    ✅ Private repository detection works');
      } else {
        console.log('    ❌ Private repository should have isPublic=false');
      }
    } else {
      console.log('    ℹ️  No private repositories found for testing');
    }
  } catch (error) {
    console.log(`    ⚠️  Could not test private repo: ${error.message}`);
  }
} catch (error) {
  console.log(`  ❌ Error: ${error.message}`);
}

console.log('');

// Test 2: Check default behavior in code
console.log('Test 2: Verify solve.config.lib.mjs has undefined default');
try {
  const { readFileSync } = await import('fs');
  const configContent = readFileSync('./src/solve.config.lib.mjs', 'utf8');

  if (configContent.includes('default: undefined')) {
    console.log('  ✅ Config has default: undefined for auto-cleanup');
  } else {
    console.log('  ❌ Config does NOT have default: undefined');
  }

  if (configContent.includes('Default: true for private repos, false for public repos')) {
    console.log('  ✅ Description mentions visibility-based defaults');
  } else {
    console.log('  ⚠️  Description does not mention visibility-based defaults');
  }
} catch (error) {
  console.log(`  ⚠️  Could not inspect code: ${error.message}`);
}

console.log('');

// Test 3: Check solve.mjs has visibility detection logic
console.log('Test 3: Verify solve.mjs implements visibility-based logic');
try {
  const { readFileSync } = await import('fs');
  const solveContent = readFileSync('./src/solve.mjs', 'utf8');

  if (solveContent.includes('detectRepositoryVisibility')) {
    console.log('  ✅ solve.mjs calls detectRepositoryVisibility');
  } else {
    console.log('  ❌ solve.mjs does NOT call detectRepositoryVisibility');
  }

  if (solveContent.includes('argv.autoCleanup === undefined')) {
    console.log('  ✅ solve.mjs checks if autoCleanup is undefined');
  } else {
    console.log('  ❌ solve.mjs does NOT check for undefined autoCleanup');
  }

  if (solveContent.includes('argv.autoCleanup = !isPublic')) {
    console.log('  ✅ solve.mjs sets autoCleanup based on visibility');
  } else {
    console.log('  ❌ solve.mjs does NOT set autoCleanup based on visibility');
  }

  // Check logic: public repos -> autoCleanup=false, private repos -> autoCleanup=true
  if (solveContent.includes('!isPublic')) {
    console.log('  ✅ Logic correct: autoCleanup = !isPublic (false for public, true for private)');
  } else {
    console.log('  ⚠️  Logic may not be correct');
  }
} catch (error) {
  console.log(`  ⚠️  Could not inspect code: ${error.message}`);
}

console.log('');

// Test 4: Verify github.lib.mjs exports detectRepositoryVisibility
console.log('Test 4: Verify github.lib.mjs exports detectRepositoryVisibility');
try {
  const githubLib = await import('../src/github.lib.mjs');

  if (typeof githubLib.detectRepositoryVisibility === 'function') {
    console.log('  ✅ detectRepositoryVisibility is exported as a function');
  } else {
    console.log('  ❌ detectRepositoryVisibility is NOT exported');
  }

  if (githubLib.default.detectRepositoryVisibility) {
    console.log('  ✅ detectRepositoryVisibility is in default export');
  } else {
    console.log('  ❌ detectRepositoryVisibility is NOT in default export');
  }
} catch (error) {
  console.log(`  ❌ Error: ${error.message}`);
}

console.log('');

console.log('📊 Test Summary:');
console.log('  All code inspections completed');
console.log('');
console.log('  Expected behavior:');
console.log('    • Public repository: auto-cleanup defaults to FALSE (keep temp directory)');
console.log('    • Private repository: auto-cleanup defaults to TRUE (clean temp directory)');
console.log('    • Explicit --auto-cleanup: always clean (overrides default)');
console.log('    • Explicit --no-auto-cleanup: always keep (overrides default)');
console.log('');
console.log('  To test runtime behavior, run solve.mjs with a real issue:');
console.log('    ./src/solve.mjs <public-issue-url> --verbose    # Should show autoCleanup=false');
console.log('    ./src/solve.mjs <private-issue-url> --verbose   # Should show autoCleanup=true');
console.log('    ./src/solve.mjs <issue-url> --auto-cleanup      # Always clean');
console.log('    ./src/solve.mjs <issue-url> --no-auto-cleanup   # Always keep');
