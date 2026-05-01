#!/usr/bin/env node

/**
 * Test script to verify solve.watch.lib.mjs can be imported without errors
 * This tests the fix for issue #326
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcPath = join(__dirname, '..', 'src');

// Mock globalThis.use to avoid fetch during import
globalThis.use = () => ({ $: () => {} });

console.log('Testing import of solve.watch.lib.mjs...');

try {
  // Try to import the module
  const watchModule = await import(join(srcPath, 'solve.watch.lib.mjs'));

  console.log('✅ Module imported successfully!');
  console.log('Available exports:', Object.keys(watchModule));

  // Verify the expected functions are exported
  if (typeof watchModule.watchForFeedback === 'function') {
    console.log('✅ watchForFeedback function is available');
  } else {
    console.log('❌ watchForFeedback function not found');
  }

  if (typeof watchModule.startWatchMode === 'function') {
    console.log('✅ startWatchMode function is available');
  } else {
    console.log('❌ startWatchMode function not found');
  }

  console.log('\n🎉 All imports resolved successfully - Issue #326 is fixed!');
  process.exit(0);
} catch (error) {
  console.error('❌ Import failed with error:', error.message);
  console.error('\nThis indicates issue #326 is NOT fixed.');
  console.error('\nFull error details:');
  console.error(error);
  process.exit(1);
}
