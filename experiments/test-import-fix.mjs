#!/usr/bin/env node

// Test that the import fix works correctly
console.log('Testing import fix for getResourceSnapshot...\n');

try {
  // Test importing from memory-check.mjs (the correct module)
  const memoryCheck = await import('../src/memory-check.mjs');
  const { getResourceSnapshot } = memoryCheck;

  console.log('✅ Import from memory-check.mjs successful');
  console.log('✅ getResourceSnapshot is a function:', typeof getResourceSnapshot === 'function');

  // Try calling it to ensure it actually works
  const snapshot = await getResourceSnapshot();
  console.log('✅ getResourceSnapshot() executed successfully');
  console.log('   Memory usage:', snapshot.memory);
  console.log('   CPU usage:', snapshot.cpu);
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}

console.log('\n✅ All tests passed! The import fix is working correctly.');
