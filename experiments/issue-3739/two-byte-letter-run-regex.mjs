// Minimal reproduction of the two-byte letter-run overflow (no library needed).
// The `key` part of sensitive-data-sanitizer's `credentialPrefix` overflows V8's
// regular-expression backtracking stack on a long letter run, but only when the
// string is stored as two-byte (it contains any character above U+00FF, such as
// the `…` of a hive mask or an emoji). One-byte strings of the same length pass.
// Usage: node experiments/issue-3739/two-byte-letter-run-regex.mjs
const re = /(?<![\p{L}\p{N}_])((?:[\p{L}\p{N}]+[_.-]){0,16}(?:auth|token|pass)(?:[_.-][\p{L}\p{N}]+){0,16})(?![\p{L}\p{N}_])[ \t]*[:=]/giu;
for (const [name, tail] of [
  ['one-byte', '\nauth: x é\n'],
  ['two-byte', '\nauth: x —\n'],
]) {
  for (const mib of [1, 4]) {
    const text = 'A'.repeat(mib * 1024 * 1024) + tail;
    try {
      console.log(name, `${mib} MiB`, [...text.matchAll(re)].length, 'match(es)');
    } catch (error) {
      console.log(name, `${mib} MiB`, error.name, error.message);
    }
  }
}
