// Times the old and new generated-footer patterns on input CodeQL flagged:
// '---\n' followed by many newlines and no badge (no match, so a backtracking
// pattern explores every way to split the newlines). Also checks that both
// patterns strip the same footer from a real formatted body.
const OLD = /\n?^---[ \t]*\n(?:\s*\n)*\s*(?:\[!\[npm version\]\(https:\/\/img\.shields\.io\/badge\/npm-|📦)[\s\S]*$/m;
const NEW = /\n?^---[ \t]*\n\s*(?:\[!\[npm version\]\(https:\/\/img\.shields\.io\/badge\/npm-|📦)[\s\S]*$/m;

const time = (pattern, input) => {
  const start = process.hrtime.bigint();
  pattern.test(input);
  return Number(process.hrtime.bigint() - start) / 1e6;
};

for (const n of [16, 20, 24, 26]) {
  const input = `---\n${'\n'.repeat(n)}x`;
  console.log(`n=${n}: old ${time(OLD, input).toFixed(1)} ms, new ${time(NEW, input).toFixed(3)} ms`);
}
const big = `---\n${'\n'.repeat(100000)}x`;
console.log(`n=100000: new ${time(NEW, big).toFixed(1)} ms`);

const body = '- abc1234: Fix.\n\n  More.\n\n**Related Pull Request:** #1\n\n---\n\n\n[![npm version](https://img.shields.io/badge/npm-1.0.0-blue.svg)](https://www.npmjs.com/package/x/v/1.0.0)';
console.log('same result:', body.replace(OLD, '') === body.replace(NEW, ''), JSON.stringify(body.replace(NEW, '')));

// Whitespace-only lines, which give `(?:\s*\n)*` more ways to split.
for (const n of [12, 16, 20, 22]) {
  const input = `---\n${' \n'.repeat(n)} x`;
  console.log(`' \\n' x${n}: old ${time(OLD, input).toFixed(1)} ms, new ${time(NEW, input).toFixed(3)} ms`);
}
