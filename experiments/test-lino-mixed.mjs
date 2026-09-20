import { parseIndented } from 'lino-objects-codec';

function unescapeString(s) {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
}

const test = `en
  prompt "You are AI issue solver.\\n
General guidelines.
   - Run as long as needed.
   - Save logs to files.\\n
Initial research.
   - Read all comments."
`;

const r = parseIndented({ text: test });
console.log('=== Raw ===');
console.log(JSON.stringify(r.obj.prompt));
console.log('\n=== Unescaped ===');
console.log(unescapeString(r.obj.prompt));
