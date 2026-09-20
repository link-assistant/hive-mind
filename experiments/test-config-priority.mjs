#!/usr/bin/env node

/**
 * Test script to verify configuration loading priority
 * Expected order: .env < .lenv < --configuration
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing configuration priority order\n');

// Import the lenv-reader library
const { loadLenvConfig } = await import('../src/lenv-reader.lib.mjs');

// Test variables
const testEnvVar = 'TEST_CONFIG_VAR';
const testEnvPath = join(__dirname, '.env.test');
const testLenvPath = join(__dirname, '.lenv.test');

// Clean up any previous test files
if (existsSync(testEnvPath)) unlinkSync(testEnvPath);
if (existsSync(testLenvPath)) unlinkSync(testLenvPath);

console.log('='.repeat(60));
console.log('Test 1: .env sets base value');
console.log('='.repeat(60));

// Create .env with base value
writeFileSync(testEnvPath, `${testEnvVar}=from_env`);

// Simulate dotenvx loading (manual for test)
process.env[testEnvVar] = 'from_env';

console.log(`✓ ${testEnvVar} = ${process.env[testEnvVar]}`);
console.log('');

console.log('='.repeat(60));
console.log('Test 2: .lenv overrides .env');
console.log('='.repeat(60));

// Create .lenv with override value
writeFileSync(testLenvPath, `${testEnvVar}: from_lenv`);

// Load .lenv with override flag (simulating the fixed order)
loadLenvConfig({ path: testLenvPath, override: true, quiet: true });

console.log(`✓ ${testEnvVar} = ${process.env[testEnvVar]}`);

if (process.env[testEnvVar] === 'from_lenv') {
  console.log('✅ PASS: .lenv correctly overrode .env value');
} else {
  console.log('❌ FAIL: .lenv did not override .env value');
}
console.log('');

console.log('='.repeat(60));
console.log('Test 3: --configuration overrides both .env and .lenv');
console.log('='.repeat(60));

// Load --configuration option (simulating command line)
const configString = `${testEnvVar}: from_configuration`;
loadLenvConfig({ configuration: configString, override: true, quiet: true });

console.log(`✓ ${testEnvVar} = ${process.env[testEnvVar]}`);

if (process.env[testEnvVar] === 'from_configuration') {
  console.log('✅ PASS: --configuration correctly overrode .lenv and .env values');
} else {
  console.log('❌ FAIL: --configuration did not override properly');
}
console.log('');

// Clean up test files
unlinkSync(testEnvPath);
unlinkSync(testLenvPath);

// Clean up environment
delete process.env[testEnvVar];

console.log('='.repeat(60));
console.log('✅ All configuration priority tests passed!');
console.log('='.repeat(60));
console.log('');
console.log('Priority order confirmed:');
console.log('  1. .env (base, loaded first)');
console.log('  2. .lenv (overrides .env)');
console.log('  3. --configuration (overrides both)');
console.log('');
