#!/usr/bin/env node

/**
 * Experiment to fix issue #159: Fork sync not working when upstream remote addition fails
 *
 * The problem:
 * - Fork sync logic is inside the `else` block of upstream remote addition
 * - If upstream remote already exists, addition fails and sync is skipped
 * - Result: Fork stays out of sync, causing merge conflicts
 *
 * The solution:
 * - Handle the case where upstream remote already exists
 * - Ensure fork sync runs regardless of remote addition success/failure
 * - Move sync logic outside conditional or make it more robust
 */

import { $ } from 'zx';

console.log('🔬 Testing Issue #159 Fix: Fork Sync When Upstream Remote Addition Fails\n');

console.log('Problem Analysis:');
console.log('================');
console.log('1. Current code structure:');
console.log('   if (upstreamResult.code !== 0) {');
console.log('     await log("Warning: Failed to add upstream remote");');
console.log('   } else {');
console.log('     // ALL FORK SYNC LOGIC IS HERE!');
console.log('     // If remote addition fails, sync never happens');
console.log('   }');
console.log('');

console.log('2. Common failure scenario:');
console.log('   - Upstream remote already exists from previous run');
console.log('   - `git remote add upstream ...` fails with "remote upstream already exists"');
console.log('   - Fork sync is completely skipped');
console.log('   - Fork stays 45+ commits behind upstream');
console.log('');

console.log('Solution Strategy:');
console.log('=================');
console.log('1. Remove existing upstream remote before adding (like in create-test-repo.mjs)');
console.log('2. OR check if upstream remote exists and skip addition if it does');
console.log('3. OR move fork sync logic outside the conditional');
console.log('4. Always attempt fork sync if we have upstream remote configured');
console.log('');

console.log('Testing the fix approach:');
console.log('========================');

// Simulate the fix
console.log('✅ Proposed fix: Always ensure upstream remote exists before sync');
console.log('   - Check if upstream remote exists: git remote get-url upstream');
console.log('   - If not exists: Add it normally');
console.log('   - If exists: Skip addition (no error!)');
console.log('   - Always proceed with fetch and sync logic');
console.log('');

console.log('Code change needed in solve.mjs around line 664:');
console.log('================================================');
console.log('');
console.log('// OLD CODE (BROKEN):');
console.log('const upstreamResult = await $({ cwd: tempDir })`git remote add upstream ...`;');
console.log('if (upstreamResult.code !== 0) {');
console.log('  await log("Warning: Failed to add upstream remote");');
console.log('} else {');
console.log('  // SYNC LOGIC ONLY RUNS HERE!');
console.log('}');
console.log('');

console.log('// NEW CODE (FIXED):');
console.log('// Check if upstream remote already exists');
console.log('const checkUpstreamResult = await $({ cwd: tempDir })`git remote get-url upstream 2>/dev/null`;');
console.log('let upstreamExists = checkUpstreamResult.code === 0;');
console.log('');
console.log('if (!upstreamExists) {');
console.log('  const upstreamResult = await $({ cwd: tempDir })`git remote add upstream ...`;');
console.log('  upstreamExists = upstreamResult.code === 0;');
console.log('  if (!upstreamExists) {');
console.log('    await log("Warning: Failed to add upstream remote");');
console.log('  }');
console.log('}');
console.log('');
console.log('// ALWAYS attempt sync if we have upstream configured');
console.log('if (upstreamExists) {');
console.log('  // SYNC LOGIC MOVES HERE - runs regardless of how upstream remote was obtained');
console.log('}');
console.log('');

console.log('🎯 This fix ensures fork sync always runs when fork mode is used!');
