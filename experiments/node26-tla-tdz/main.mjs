// Entry: static import of a (first) and b (second). Node 24 prints "ok 2"; check Node 26.
import { a } from './a.mjs';
import { x } from './b.mjs';
console.log('ok', a(), x);
