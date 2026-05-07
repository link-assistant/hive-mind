#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { lino } = await import('../src/lino.lib.mjs');

console.log('Testing Lino Notation Parsing\n');

const testCases = [
  {
    name: 'Multi-line lino format',
    input: '(\n  123456789\n  987654321\n  555555555\n)',
    expected: [123456789, 987654321, 555555555],
  },
  {
    name: 'Single line lino format',
    input: '(123456789 987654321)',
    expected: [123456789, 987654321],
  },
  {
    name: 'Empty lino',
    input: '()',
    expected: [],
  },
  {
    name: 'Null/undefined',
    input: null,
    expected: [],
  },
];

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log(`Input: ${JSON.stringify(testCase.input)}`);

  const result = lino.parseNumericIds(testCase.input);
  console.log(`Result: ${JSON.stringify(result)}`);
  console.log(`Expected: ${JSON.stringify(testCase.expected)}`);

  const passed = JSON.stringify(result) === JSON.stringify(testCase.expected);
  console.log(`Status: ${passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('---\n');
}

console.log('\nFormatting test:');
const chatIds = [123456789, 987654321, 555555555];
const formatted = lino.format(chatIds);
console.log('Input array:', chatIds);
console.log('Formatted lino:');
console.log(formatted);
