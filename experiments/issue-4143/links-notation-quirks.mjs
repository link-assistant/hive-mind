// Raw links-notation 0.31.8 behaviours that shaped the bot state quoting rules
// (issue #4143). Run: node experiments/issue-4143/links-notation-quirks.mjs
import { loadLinoParser } from '../../src/bot-state-lino.lib.mjs';
const parser = await loadLinoParser();
const show = l => (l && typeof l === 'object' ? (l.values?.length ? [l.id, ...l.values.map(show)] : l.id) : l);
const cases = {
  'value starting with # is a comment': 'root:\n  tag #release\n  next 1\n',
  'url with #fragment': 'root:\n  url https://x/y#frag\n  next 1\n',
  'two empty strings on different lines': 'root:\n  a ""\n  b ""\n  next 1\n',
  'empty string then a quoted value': 'root:\n  a ""\n  b "x y"\n',
  'empty single-quoted strings': "root:\n  a ''\n  b ''\n",
  'colon inside an unquoted value': 'root:\n  time 12:30\n',
  'quoted vs unquoted are indistinguishable': 'root:\n  a "1"\n  b 1\n',
  'doubled quote vs empty+empty': 'root:\n  a """"\n',
};
for (const [name, text] of Object.entries(cases)) {
  let result;
  try {
    result = JSON.stringify(parser.parse(text).map(show));
  } catch (error) {
    result = `ERROR ${error.message.split('\n')[0]}`;
  }
  console.log(`${name}\n  input:  ${JSON.stringify(text)}\n  output: ${result}`);
}

// lino-objects-codec formatIndented output read by the links-notation Parser.
for (const text of ["root:\n  a ''\n  b ''", 'root:\n  tag #release\n  next 1']) {
  console.log(`codec output ${JSON.stringify(text)}\n  links-notation reads: ${JSON.stringify(parser.parse(text).map(show))}`);
}
const lnVersion = await import('node:fs').then(fs => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../node_modules/links-notation/package.json', import.meta.url))).version;
  } catch {
    return 'unknown';
  }
});
console.log(`(node_modules links-notation ${lnVersion}; the parser above is loaded through use-m as in src/lino.lib.mjs)`);
