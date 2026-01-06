#!/usr/bin/env node

// Test regex patterns

const testStrings = ['8490aOEM', '(a b c)', '(\n  a\n  b\n)', 'value', 'my-option', '123', 'normalword'];

const regex1 = /[()\\n\r]|^\d|  /; // My current regex with \\n
const regex2 = /[()\n\r]|^\d|  /; // Corrected regex with \n

console.log('Testing regex patterns:\n');

for (const str of testStrings) {
  const match1 = regex1.test(str);
  const match2 = regex2.test(str);
  console.log(`String: "${str.replace(/\n/g, '\\n')}"`);
  console.log(`  Regex1 (\\\\n): ${match1}`);
  console.log(`  Regex2 (\\n):  ${match2}`);
  console.log('');
}
