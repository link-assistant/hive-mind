#!/usr/bin/env node
// Script to analyze all child_process calls and identify which need env parameter

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const srcFiles = execSync('find ./src -name "*.mjs" -o -name "*.js"', { encoding: 'utf8' }).trim().split('\n');
const testFiles = execSync('find ./tests -name "*.mjs" -o -name "*.js" 2>/dev/null || true', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

const allFiles = [...srcFiles, ...testFiles];

const results = {
  spawn: [],
  exec: [],
  execSync: [],
  execFile: [],
  execFileSync: []
};

for (const file of allFiles) {
  if (!file) continue;

  try {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // Check for spawn calls
      if (/\bspawn\s*\(/.test(line)) {
        results.spawn.push({ file, line: lineNum, content: line.trim() });
      }

      // Check for exec calls (promisified or callback)
      if (/\bexec\s*\(/.test(line) && !/execSync/.test(line) && !/execFile/.test(line)) {
        results.exec.push({ file, line: lineNum, content: line.trim() });
      }

      // Check for execSync calls
      if (/\bexecSync\s*\(/.test(line)) {
        results.execSync.push({ file, line: lineNum, content: line.trim() });
      }

      // Check for execFile calls
      if (/\bexecFile\s*\(/.test(line) && !/execFileSync/.test(line)) {
        results.execFile.push({ file, line: lineNum, content: line.trim() });
      }

      // Check for execFileSync calls
      if (/\bexecFileSync\s*\(/.test(line)) {
        results.execFileSync.push({ file, line: lineNum, content: line.trim() });
      }
    });
  } catch (err) {
    console.error(`Error reading ${file}: ${err.message}`);
  }
}

console.log('=== Analysis of child_process calls ===\n');

for (const [method, calls] of Object.entries(results)) {
  if (calls.length > 0) {
    console.log(`\n${method.toUpperCase()} calls (${calls.length}):`);
    console.log('='.repeat(50));
    calls.forEach(({ file, line, content }) => {
      console.log(`${file}:${line}`);
      console.log(`  ${content}`);
    });
  }
}
