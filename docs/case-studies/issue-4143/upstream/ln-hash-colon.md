## Summary

In links-notation 0.31.8 (JS), two kinds of plain values that are common in real data cannot be written unquoted, and one of them loses data without any error:

1. **A value that starts with `#` is silently dropped as a comment.** `tag #release` becomes just the reference `tag`. The line no longer forms a link, and the parser reports no error.
2. **A value that contains `:` is a syntax error.** URLs, times and `key:value` pairs such as `https://x/y#frag` or `12:30` fail to parse unless they are quoted.

## Reproduction

```js
import { Parser } from 'links-notation'; // 0.31.8
const p = new Parser();
const show = l => (l && typeof l === 'object' ? (l.values?.length ? [l.id, ...l.values.map(show)] : l.id) : l);
for (const t of ['root:\n  tag #release\n  next 1\n', 'root:\n  time 12:30\n', 'root:\n  url https://x/y#frag\n'])
  try {
    console.log(JSON.stringify(p.parse(t).map(show)));
  } catch (e) {
    console.log('ERROR', e.message.split('\n')[0]);
  }
```

Output:

```
[["root","tag",[null,"next","1"]]]
ERROR Syntax error at line 2, column 10: Expected "(", [ \t], [\r\n], or [^ \t\n\r(:)] but ":" found.
ERROR Syntax error at line 2, column 12: Expected "(", [ \t], [\r\n], or [^ \t\n\r(:)] but ":" found.
```

The `:` error is at least loud. The `#` case is the dangerous one: `lino-objects-codec`'s `formatIndented` writes `tag #release` unquoted, and the `Parser` reads it back without the value.

## Workaround

hive-mind quotes every value that starts with `#` or contains `:`, whitespace, quotes or parentheses (`quoteLinoScalar` in `src/bot-state-lino.lib.mjs`, link-assistant/hive-mind#4143).

## Suggested fix

1. Treat `#` as a comment only at the start of a line (after indentation), or only when followed by a space. Otherwise, warn or fail rather than dropping a value in reference position.
2. Allow `:` inside a reference when it is not followed by whitespace or the end of the line, so `https://x` and `12:30` parse as references.
3. Export a `needsQuoting(string)` / `quoteReference(string)` helper from links-notation, so formatters in other packages (lino-objects-codec, link-cli) share one definition of a safe bare reference.
