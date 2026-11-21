// Renders Telegram legacy Markdown per the Bot API rules: outside entities a backslash escapes
// only _ * ` [ (any other backslash is literal); inside entities nothing is escaped and the
// entity ends at its first closing character. Shows that inputs containing backslashes render
// exactly as typed, so escapeLegacyMarkdown must not double backslashes.
import { formatInputLocationMarkdown } from '../src/input-diagnostics.lib.mjs';

const renderLegacy = text => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && '_*`['.includes(text[i + 1])) out += text[++i];
    else if ('_*`['.includes(text[i])) {
      const pre = text.startsWith('```', i);
      const close = pre ? '```' : text[i] === '[' ? ']' : text[i];
      const from = i + (pre ? 3 : 1);
      const end = text.indexOf(close, from);
      if (end < 0) throw new Error(`Can't find end of the entity starting at ${i}: ${JSON.stringify(text)}`);
      out += text.slice(from, end);
      i = end + close.length - 1;
    } else out += text[i];
  }
  return out;
};

let failed = false;
for (const input of ['a\\_b', 'x\\', '\\\\*q', 'o/r`x\\[y_z', '\\`\\', 'p\\*s']) {
  const markdown = formatInputLocationMarkdown(input, { part: input.slice(1, 3), start: 1, end: 3 });
  const rendered = renderLegacy(markdown);
  const shown = input.includes('`') ? rendered.split('\n')[1] : rendered.split('\n')[2];
  const expected = input.includes('`') ? input.slice(0, 1) + input.slice(1, 3).toUpperCase() + input.slice(3) : input;
  const ok = shown === expected;
  failed ||= !ok;
  console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(input), '->', JSON.stringify(markdown), '=>', JSON.stringify(rendered));
}
process.exit(failed ? 1 : 0);
