#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

console.log('📦 Testing NPM package files configuration...\n');

// Get the files list from package.json
const filesPatterns = packageJson.files || [];
console.log('Files patterns in package.json:');
filesPatterns.forEach(pattern => console.log(`  - ${pattern}`));
console.log();

// List of files that must be included for solve.mjs to work
const requiredFiles = ['solve.mjs', 'solve.auto-continue.lib.mjs', 'solve.claude-execution.lib.mjs', 'solve.config.lib.mjs', 'solve.execution.lib.mjs', 'solve.feedback.lib.mjs', 'solve.repository.lib.mjs', 'solve.results.lib.mjs', 'solve.validation.lib.mjs', 'lib.mjs', 'claude.lib.mjs', 'github.lib.mjs', 'memory-check.mjs'];

console.log('✅ Checking required files for solve.mjs:');
let allFound = true;

for (const file of requiredFiles) {
  const filePath = path.join(rootDir, file);
  const exists = fs.existsSync(filePath);
  const inPackageJson =
    filesPatterns.includes(file) ||
    filesPatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(file);
      }
      return pattern === file;
    });

  if (!exists) {
    console.log(`  ❌ ${file} - File does not exist!`);
    allFound = false;
  } else if (!inPackageJson) {
    console.log(`  ⚠️  ${file} - Exists but not in package.json files!`);
    allFound = false;
  } else {
    console.log(`  ✅ ${file} - OK`);
  }
}

console.log('\n📋 Summary:');
if (allFound) {
  console.log('✅ All required files are present and will be included in NPM package');
} else {
  console.log('❌ Some files are missing or not properly configured in package.json');
  process.exit(1);
}

// Also check for other executables
console.log('\n📦 Checking other executable files:');
const executables = ['hive.mjs', 'task.mjs', 'review.mjs'];
for (const exe of executables) {
  const filePath = path.join(rootDir, exe);
  const exists = fs.existsSync(filePath);
  const inPackageJson = filesPatterns.includes(exe);

  if (exists && inPackageJson) {
    console.log(`  ✅ ${exe} - OK`);
  } else if (!exists) {
    console.log(`  ❌ ${exe} - File does not exist!`);
  } else {
    console.log(`  ⚠️  ${exe} - Not in package.json!`);
  }
}
