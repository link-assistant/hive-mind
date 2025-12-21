#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing path resolution for start-screen.mjs');
console.log('Current file:', __filename);
console.log('Current directory:', __dirname);

const startScreenPath = join(__dirname, '..', 'start-screen.mjs');
console.log('Resolved start-screen.mjs path:', startScreenPath);

console.log('\nChecking if file exists...');
import { existsSync } from 'fs';
console.log('File exists:', existsSync(startScreenPath));

console.log('\nTesting command construction:');
const command = 'solve';
const args = ['https://github.com/test/repo/issues/1', '--verbose'];

const quotedArgs = args
  .map(arg => {
    if (
      arg.includes(' ') ||
      arg.includes('&') ||
      arg.includes('|') ||
      arg.includes(';') ||
      arg.includes('$') ||
      arg.includes('*') ||
      arg.includes('?') ||
      arg.includes('(') ||
      arg.includes(')')
    ) {
      return `'${arg.replace(/'/g, "'\\''")}'`;
    }
    return arg;
  })
  .join(' ');

const fullCommandOld = `start-screen ${command} ${quotedArgs}`;
const fullCommandNew = `node ${startScreenPath} ${command} ${quotedArgs}`;

console.log('Old command (broken):', fullCommandOld);
console.log('New command (fixed):', fullCommandNew);

console.log('\nTest completed successfully!');
