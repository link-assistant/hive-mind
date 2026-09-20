// Test multiline references in Links Notation
import { parseIndented } from 'lino-objects-codec';

// Test placeholder substitution with multiline content
const test1 = `en
  prompt.system "You are AI issue solver.

General guidelines.
   - Run as long as needed.
   - Save logs to files.
   - Use {{owner}}/{{repo}} for context.

Initial research.
   - Read all comments.
   - Use gh issue view {{issueUrl}}."
`;

console.log('=== Multiline prompt with placeholders ===');
const r1 = parseIndented({ text: test1 });
console.log(JSON.stringify(r1, null, 2));
console.log('\n--- Substituted ---');
let val = r1.obj['prompt.system'];
val = val
  .replace(/\{\{owner\}\}/g, 'octocat')
  .replace(/\{\{repo\}\}/g, 'hello-world')
  .replace(/\{\{issueUrl\}\}/g, 'https://x.y/z/123');
console.log(val);
