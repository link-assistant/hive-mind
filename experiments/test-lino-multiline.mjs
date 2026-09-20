// Test multiline quoted expressions in Links Notation
import { parseIndented } from 'lino-objects-codec';

const test1 = `en
  greeting "Hello"
  multiline_test "First line\\nSecond line\\nThird line"
`;

console.log('=== Test 1: Single-line with escaped \\n ===');
const r1 = parseIndented({ text: test1 });
console.log(JSON.stringify(r1, null, 2));

const test2 = `en
  greeting "Hello"
  multiline "First line
Second line
Third line"
`;

console.log('=== Test 2: True multiline quoted (newlines inside quotes) ===');
try {
  const r2 = parseIndented({ text: test2 });
  console.log(JSON.stringify(r2, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}

const test3 = `en
  prompt
    "First line
    Second line
    Third line"
`;

console.log('=== Test 3: Indented multiline ===');
try {
  const r3 = parseIndented({ text: test3 });
  console.log(JSON.stringify(r3, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}

const test4 = `en
  prompt: '
    Line one
    Line two
  '
`;

console.log('=== Test 4: Other multiline syntax ===');
try {
  const r4 = parseIndented({ text: test4 });
  console.log(JSON.stringify(r4, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}
