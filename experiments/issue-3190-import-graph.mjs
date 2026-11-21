// Print the transitive static+dynamic import closure of a module (issue #3190 helper).
import fs from 'node:fs';
import path from 'node:path';
const start = path.resolve(process.argv[2]);
const seen = new Set();
const visit = file => {
  if (seen.has(file) || !fs.existsSync(file)) return;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:from\s+|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) visit(path.resolve(path.dirname(file), m[1]));
};
visit(start);
console.log([...seen].map(f => path.relative(process.cwd(), f)).join('\n'));
