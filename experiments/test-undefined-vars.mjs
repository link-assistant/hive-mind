#!/usr/bin/env node

// Test script to find undefined variables in JavaScript files
// This helps identify the root cause mentioned in issue #204

import { promises as fs } from 'fs';
import path from 'path';

const filesToCheck = ['./hive.mjs', './solve.mjs'];

// Simple AST-like parser to find potential undefined variables
function findPotentialUndefinedVars(code, fileName) {
  const issues = [];

  // Remove comments and strings to avoid false positives
  const cleanedCode = code
    .replace(/\/\/.*/g, '') // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
    .replace(/'[^']*'/g, "''") // Remove string content (single quotes)
    .replace(/"[^"]*"/g, '""') // Remove string content (double quotes)
    .replace(/`[^`]*`/g, '``'); // Remove template literals

  // Look for common undefined variable patterns
  const patterns = [
    // Check for 'solve' without quotes or as part of larger word
    { regex: /\b(?<!\.)solve(?![a-zA-Z])(?!\s*[:=])/g, name: 'solve (standalone)' },
    // Check for variables that might not be defined
    { regex: /\b(?<!['"`])(undefined|null)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g, name: 'undefined variable reference' },
    // Check for typos in common variable names
    { regex: /\b(solveCmd|solveComand|sloveCommand)\b/g, name: 'possible typo' }
  ];

  const lines = cleanedCode.split('\n');

  patterns.forEach(pattern => {
    lines.forEach((line, lineNum) => {
      const matches = [...line.matchAll(pattern.regex)];
      if (matches.length > 0) {
        matches.forEach(match => {
          issues.push({
            file: fileName,
            line: lineNum + 1,
            type: pattern.name,
            match: match[0],
            context: code.split('\n')[lineNum].trim()
          });
        });
      }
    });
  });

  return issues;
}

console.log('🔍 Checking for undefined variables and potential issues...\n');

for (const file of filesToCheck) {
  try {
    const fullPath = path.resolve(file);
    const content = await fs.readFile(fullPath, 'utf8');
    const issues = findPotentialUndefinedVars(content, file);

    if (issues.length > 0) {
      console.log(`\n⚠️  Potential issues in ${file}:`);
      issues.forEach(issue => {
        console.log(`   Line ${issue.line}: ${issue.type}`);
        console.log(`      Match: "${issue.match}"`);
        console.log(`      Context: ${issue.context}`);
      });
    } else {
      console.log(`✅ No obvious undefined variable issues in ${file}`);
    }
  } catch (error) {
    console.error(`❌ Error checking ${file}: ${error.message}`);
  }
}

console.log('\n🔍 Running actual syntax check with Node.js...');

// Try to import/parse the files to find syntax errors
for (const file of filesToCheck) {
  try {
    const fullPath = path.resolve(file);
    console.log(`\n   Checking ${file}...`);

    // Use dynamic import to check for syntax errors
    const startTime = Date.now();
    await import(fullPath);
    const elapsed = Date.now() - startTime;

    console.log(`   ✅ ${file} loaded successfully (${elapsed}ms)`);
  } catch (error) {
    console.error(`   ❌ Error in ${file}:`);
    console.error(`      ${error.message}`);
    if (error.stack) {
      const stackLines = error.stack.split('\n').slice(0, 3);
      stackLines.forEach(line => console.error(`      ${line}`));
    }
  }
}

console.log('\n✅ Check complete!');
