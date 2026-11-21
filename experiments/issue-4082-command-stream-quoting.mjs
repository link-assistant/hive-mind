/* global console */
// Issue #4082: check that command-stream passes a GraphQL query with `$var` and quotes untouched.
const { $ } = await import('command-stream');
const q = 'query($owner: String!) { x(a: "b") } \'single\'';
const r = await $({ mirror: false, capture: true })`printf %s ${`query=${q}`}`;
console.log(JSON.stringify(r.stdout.toString()));
console.log(r.stdout.toString() === `query=${q}` ? 'OK: passed verbatim' : 'MISMATCH');
