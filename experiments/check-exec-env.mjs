#!/usr/bin/env node
// Script to check which execSync/exec calls are missing env parameter

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Get all source files
const srcFiles = execSync('find ./src -name "*.mjs" -o -name "*.js"', { encoding: 'utf8' }).trim().split('\n');

const missing = [];

for (const file of srcFiles) {
  if (!file) continue;

  try {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    // Find execSync calls
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      if (/\bexecSync\s*\(/.test(line)) {
        // Check if it has options object
        let fullCall = line;
        let j = i;

        // Collect full call (might span multiple lines)
        let braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        while (braceCount > 0 && j < lines.length - 1) {
          j++;
          fullCall += '\n' + lines[j];
          braceCount += (lines[j].match(/{/g) || []).length - (lines[j].match(/}/g) || []).length;
        }

        // Check if it has env parameter
        if (fullCall.includes(', {') && !fullCall.includes('env:')) {
          missing.push({
            file,
            line: lineNum,
            call: fullCall.replace(/\s+/g, ' ').substring(0, 150)
          });
        }
      }
    }
  } catch (err) {
    console.error(`Error reading ${file}: ${err.message}`);
  }
}

console.log('=== execSync calls missing env parameter ===\n');
console.log(`Found ${missing.length} calls missing env parameter:\n`);

missing.forEach(({ file, line, call }) => {
  console.log(`${file}:${line}`);
  console.log(`  ${call}...`);
  console.log('');
});
