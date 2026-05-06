import { parseIndented } from 'lino-objects-codec';

// Test if blank lines are preserved using \n in strings
const test1 = `en
  s "Line A\\n\\nLine B"
`;

const r1 = parseIndented({ text: test1 });
console.log('=== Test 1 (escaped \\n\\n) ===');
console.log('raw:', JSON.stringify(r1.obj.s));

// Test multi-line block where we explicitly include blank lines via consecutive \n
const test2 = `en
  s "Para 1.

Para 2.

Para 3."
`;
const r2 = parseIndented({ text: test2 });
console.log('=== Test 2 (literal blank lines) ===');
console.log('raw:', JSON.stringify(r2.obj.s));
