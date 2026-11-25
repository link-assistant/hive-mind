// Probe which scalars links-notation reads back unchanged in key and value
// positions of the indented state format (issue #4143).
import { loadLinoParser, parseLinoTree, formatLinoTree, stringTreesEqual } from '../../src/bot-state-lino.lib.mjs';
const parser = await loadLinoParser();
const samples = process.argv.slice(2).length ? process.argv.slice(2) : ['#', '//', ',', '=', '\\', '~', '-', '.', 'a#b', '#a', '', ' ', 'a b', '"', "'", '`', 'é', '😀', 'a\tb', 'a\nb', '\nZ', 'x\n', '1', '-1', 'true', 'null'];
for (const s of samples) {
  for (const tree of [{ k: s, z: 'tail' }, { [s || 'E']: 'v', z: 'tail' }, { arr: [s, 'tail'] }, { o: { k: s }, z: 'tail' }]) {
    const text = formatLinoTree(tree);
    let got;
    try { got = (await parseLinoTree(text, { parser })).tree; } catch (e) { got = 'ERR ' + e.message; }
    if (!stringTreesEqual(got, tree)) console.log('FAIL', JSON.stringify(s), JSON.stringify(text), '=>', JSON.stringify(got));
  }
}
console.log('done');
