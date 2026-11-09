// Issue #4025: CodeQL js/redos on use-m-single-flight's SPECIFIER_PATTERN.
// `(?:\/[^@]+)*` and `(?:\/[^@]+)?` accept the same strings (a path piece
// already contains '/'), but only the first backtracks exponentially.
// Checks the two patterns agree on a corpus and times the pathological input.
const OLD = /^(?<packageName>(@[^@/]+\/)?[^@/]+)?(?:@(?<version>[^/]*))?(?<modulePath>(?:\/[^@]+)*)?$/;
const NEW = /^(?<packageName>(@[^@/]+\/)?[^@/]+)?(?:@(?<version>[^/]*))?(?<modulePath>(?:\/[^@]+)?)$/;
const corpus = ['fs', 'lodash', 'lodash@4', 'lodash@4.17.21/fp', '@scope/pkg', '@scope/pkg@1.2.3', '@scope/pkg@1/a/b/c', 'pkg/sub/path.js', 'pkg@latest/x', 'pkg//x', 'pkg/', 'a@b@c', '@s/p/x@y', 'pkg@/x'];
let mismatches = 0;
for (const s of corpus) {
  const a = s.match(OLD)?.groups;
  const b = s.match(NEW)?.groups;
  const norm = g => (g ? JSON.stringify({ ...g, modulePath: g.modulePath ?? '' }) : 'null');
  if (norm(a) !== norm(b)) {
    mismatches++;
    console.log('MISMATCH', s, norm(a), norm(b));
  }
}
const evil = 'a' + '/a'.repeat(24) + '@';
let t = Date.now();
NEW.test(evil);
console.log(`new pattern on pathological input: ${Date.now() - t} ms`);
if (process.argv.includes('--old')) {
  t = Date.now();
  OLD.test(evil);
  console.log(`old pattern on pathological input: ${Date.now() - t} ms`);
}
console.log(mismatches === 0 ? 'patterns agree on the corpus' : `${mismatches} mismatches`);
process.exit(mismatches ? 1 : 0);
