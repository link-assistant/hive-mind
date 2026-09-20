#!/usr/bin/env node

// Test to verify hive accepts any model by checking the argument parsing
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the hive.mjs file and check if it has model choices
const hiveContent = readFileSync(join(__dirname, 'src/hive.mjs'), 'utf8');

console.log('🔍 Checking hive.mjs for model choice restrictions...\n');

// Look for the model option configuration
const modelOptionMatch = hiveContent.match(/\.option\('model',\s*\{[^}]+\}/s);

if (modelOptionMatch) {
  const modelOption = modelOptionMatch[0];
  console.log('Found model option configuration:');
  console.log(modelOption);

  if (modelOption.includes('choices:')) {
    console.log('\n❌ FAIL: Model option still has choices restriction');
    process.exit(1);
  } else {
    console.log('\n✅ SUCCESS: Model option has no choices restriction');
  }
} else {
  console.log('❌ FAIL: Could not find model option configuration');
  process.exit(1);
}

// Check config.lib.mjs as well
console.log('\n🔍 Checking config.lib.mjs for model configuration...');
const configContent = readFileSync(join(__dirname, 'src/config.lib.mjs'), 'utf8');

if (configContent.includes('restrictModels')) {
  console.log('✅ SUCCESS: Added restrictModels configuration to config.lib.mjs');
} else {
  console.log('❌ FAIL: restrictModels configuration not found');
  process.exit(1);
}

console.log('\n🎉 All checks passed! The fix should resolve issue #443.');
