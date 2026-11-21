// Lists solve option aliases/types used by the issue #3190 forwarding index.
import { SOLVE_CLI_OPTION_DEFINITIONS as d } from '../src/solve.forwarded-args.lib.mjs';
for (const [k, v] of Object.entries(d)) if (v.alias) console.log(k, JSON.stringify(v.alias), v.type);
console.log('total', Object.keys(d).length);
for (const n of ['think', 'auto-merge', 'tool-check', 'disable-report-issue', 'language', 'resume', 'auto-continue']) console.log(n, JSON.stringify(d[n] && { type: d[n].type, default: d[n].default, alias: d[n].alias }));
const types = {};
for (const v of Object.values(d)) types[v.type] = (types[v.type] || 0) + 1;
console.log(types);
