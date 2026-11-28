// Issue #4143: does src/lino.lib.mjs (links-notation formatLinks) round-trip the values the parser misreads?
import { lino } from '../../src/lino.lib.mjs';
const cases = [['#x', 'y'], ['', ''], ['a:b'], ['12:30'], ['--model', 'opus'], ['"', "'"]];
for (const values of cases) {
  const text = lino.format(values);
  let back;
  try {
    back = lino.parseStringValues ? lino.parseStringValues(text) : lino.parse(text);
  } catch (e) {
    back = 'ERROR ' + e.message.split('\n')[0];
  }
  console.log(JSON.stringify(values), '=>', JSON.stringify(text), '=>', JSON.stringify(back));
}
