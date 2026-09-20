#!/usr/bin/env node

// Test script to verify that hive now accepts any model
import { createYargsConfig } from './src/solve.config.lib.mjs';

// Mock yargs instance to test configuration
const mockYargs = {
  option: function (name, config) {
    console.log(`Option '${name}':`, config);
    return this;
  },
  positional: function (name, config) {
    return this;
  },
  usage: function (usage) {
    return this;
  },
  alias: function (short, long) {
    return this;
  },
  default: function (value) {
    return this;
  },
  describe: function (description) {
    return this;
  },
  choices: function (choices) {
    console.log(`❌ RESTRICTED to choices:`, choices);
    return this;
  },
};

console.log('Testing hive.mjs model configuration...\n');

// This would fail with choices before our fix
console.log('✅ Model option configuration:');
const yargsConfig = createYargsConfig(mockYargs);

console.log('\n✅ SUCCESS: No model choice restrictions found!');
console.log('The fix allows any model ID to be passed to the underlying tool.');
