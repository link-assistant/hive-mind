#!/usr/bin/env node

/**
 * Comprehensive verification script for all command options
 * This script compares documentation in README.md with actual code implementation
 */

import fs from 'fs';
import path from 'path';

console.log('='.repeat(80));
console.log('COMPREHENSIVE OPTIONS VERIFICATION');
console.log('Comparing README.md documentation with actual code implementation');
console.log('='.repeat(80));

const readmeContent = fs.readFileSync('README.md', 'utf8');
const hiveContent = fs.readFileSync('src/hive.mjs', 'utf8');
const solveConfigContent = fs.readFileSync('src/solve.config.lib.mjs', 'utf8');

// Extract solve options from README
console.log('\n📋 SOLVE COMMAND OPTIONS FROM README:');
console.log('-'.repeat(80));
const solveSection = readmeContent.match(/## 🚀 solve Options\s*```bash\s*([\s\S]*?)\s*```/);
if (solveSection) {
  const options = solveSection[1].split('\n').filter(line => line.trim().startsWith('--'));
  options.forEach(opt => console.log(opt));
}

// Extract hive options from README
console.log('\n📋 HIVE COMMAND OPTIONS FROM README:');
console.log('-'.repeat(80));
const hiveSection = readmeContent.match(/## 🔧 hive Options\s*```bash\s*([\s\S]*?)\s*```/);
if (hiveSection) {
  const options = hiveSection[1].split('\n').filter(line => line.trim().startsWith('--'));
  options.forEach(opt => console.log(opt));
}

// Extract solve options from code
console.log('\n💻 SOLVE COMMAND OPTIONS FROM CODE (solve.config.lib.mjs):');
console.log('-'.repeat(80));
const solveOptionMatches = solveConfigContent.matchAll(/\.option\('([^']+)',\s*\{[^}]*description:\s*['"`]([^'"`]+)['"`][^}]*default:\s*([^,}]+)[^}]*\}/g);
for (const match of solveOptionMatches) {
  const [, name, desc, defaultVal] = match;
  console.log(`  --${name.padEnd(30)} ${desc.substring(0, 50)}... [default: ${defaultVal.trim()}]`);
}

// Extract hive options from code
console.log('\n💻 HIVE COMMAND OPTIONS FROM CODE (hive.mjs):');
console.log('-'.repeat(80));
const hiveOptionMatches = hiveContent.matchAll(/\.option\('([^']+)',\s*\{[^}]*description:\s*['"`]([^'"`]+)['"`][^}]*default:\s*([^,}]+)[^}]*\}/g);
for (const match of hiveOptionMatches) {
  const [, name, desc, defaultVal] = match;
  console.log(`  --${name.padEnd(30)} ${desc.substring(0, 50)}... [default: ${defaultVal.trim()}]`);
}

// Special check for --auto-continue
console.log('\n🔍 SPECIAL CHECK: --auto-continue option');
console.log('='.repeat(80));

console.log('\nIn README (solve):');
const solveAutoContMatch = readmeContent.match(/--auto-continue\s+([^\[]+)\[/);
if (solveAutoContMatch) {
  console.log(`  "${solveAutoContMatch[1].trim()}"`);
}

console.log('\nIn README (hive):');
const hiveAutoContMatch = readmeContent.match(/--auto-continue\s+([^\[]+)\[default: false\]/);
if (hiveAutoContMatch) {
  console.log(`  "${hiveAutoContMatch[1].trim()}"`);
}

console.log('\nIn CODE (solve.config.lib.mjs):');
const solveCodeMatch = solveConfigContent.match(/\.option\('auto-continue',\s*\{[^}]*description:\s*[`']([^`']+)[`']/);
if (solveCodeMatch) {
  console.log(`  "${solveCodeMatch[1]}"`);
}

console.log('\nIn CODE (hive.mjs):');
const hiveCodeMatch = hiveContent.match(/\.option\('auto-continue',\s*\{[^}]*description:\s*[`']([^`']+)[`']/);
if (hiveCodeMatch) {
  console.log(`  "${hiveCodeMatch[1]}"`);
}

console.log('\nIn CODE error message (hive.mjs):');
const hiveErrorMatch = hiveContent.match(/--auto-continue: ([^\n]+)/);
if (hiveErrorMatch) {
  console.log(`  "${hiveErrorMatch[1].trim()}"`);
}

console.log('\n✅ Verification complete. Review the output above for inconsistencies.');
