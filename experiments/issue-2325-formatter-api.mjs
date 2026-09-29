import process from 'node:process';

import '../src/lino.lib.mjs';

const { Link, FormatOptions, formatLinks, Parser } = await globalThis.use('links-notation');
const parser = new Parser();
const values = ['plain', 'two words', '#tag', 'has (parentheses)', 'line\nbreak'];
const leaves = values.map(value => new Link(value));
const pair = new Link(null, [new Link('-1002975819706'), new Link('857')]);

for (const [name, formatted] of [
  ['leaves', formatLinks(leaves)],
  ['parent', new Link(null, leaves).format()],
  ['parent with indentation', new Link(null, leaves).format(new FormatOptions({ maxInlineRefs: 0, preferInline: false }))],
  ['pairs', formatLinks([pair])],
  ['parent of pairs', new Link(null, [pair]).format()],
]) {
  process.stdout.write(`${name} ${JSON.stringify(formatted)} ${JSON.stringify(parser.parse(formatted))}\n`);
}
