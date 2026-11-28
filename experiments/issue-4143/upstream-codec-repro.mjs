// Issue #4143 upstream reproduction. Run from a directory with links-notation@0.31.8 (and lino-objects-codec@1.1.0) installed.
import { formatIndented } from 'lino-objects-codec';
import { Parser } from 'links-notation';
const show = l => (l && typeof l === 'object' ? (l.values?.length ? [l.id, ...l.values.map(show)] : l.id) : l);
const text = formatIndented({ id: 'hive_mind_state', obj: { tasks: { 'q-1': { args: ['--model', '', '#x'] } }, a: '', b: '' } });
console.log(text);
console.log(JSON.stringify(new Parser().parse(text).map(show)));
