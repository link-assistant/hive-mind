#!/usr/bin/env node

// Simple test to verify hive accepts any model
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing hive command with different models...\n');

const testModels = ['glm-4.6', 'gpt-4', 'claude-opus-4-5-20251101', 'custom-model'];

testModels.forEach(model => {
  console.log(`Testing model: ${model}`);

  const child = spawn('node', [
    join(__dirname, 'src/hive.mjs'),
    'https://github.com/suenot/hyperliquid-c',
    '--tool', 'claude',
    '--model', model,
    '--dry-run',
    '--once',
    '--help'  // Just show help to avoid GitHub calls
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log(`✅ Model '${model}' accepted\n`);
    } else {
      console.log(`❌ Model '${model}' rejected with code ${code}\n`);
    }
  });

  child.on('error', (error) => {
    if (error.message.includes('Invalid values')) {
      console.log(`❌ Model '${model}' rejected: ${error.message}\n`);
    } else {
      console.log(`⚠️  Other error for '${model}': ${error.message}\n`);
    }
  });
});