## Summary

In links-notation 0.31.8 (JS, also loaded through use-m), an empty quoted string at the end of a line pairs with the next quote on a later line. Two `key ""` (or `key ''`) lines are read as a single value that spans both lines, and the second key disappears.

## Reproduction

```js
import { Parser } from 'links-notation'; // 0.31.8
const p = new Parser();
const show = l => (l && typeof l === 'object' ? (l.values?.length ? [l.id, ...l.values.map(show)] : l.id) : l);
for (const t of ['root:\n  a ""\n  b ""\n', "root:\n  a ''\n  b ''\n", 'root:\n  a ""\n  b "x y"\n']) console.log(JSON.stringify(t), '=>', JSON.stringify(p.parse(t).map(show)));
```

Output:

```
"root:\n  a \"\"\n  b \"\"\n" => [["root",[null,"a","\n  b "]]]
"root:\n  a ''\n  b ''\n" => [["root",[null,"a","\n  b "]]]
"root:\n  a \"\"\n  b \"x y\"\n" => [["root",[null,"a",""],[null,"b","x y"]]]
```

Expected for the first two: `[["root",[null,"a",""],[null,"b",""]]]`. In the third case the second line holds a non-empty string and the result is correct, so the outcome depends on what follows. A closely related ambiguity: `(a: """")` reads as `""` (an empty string in a two-quote delimiter), not as `"` (a doubled quote inside one-quote delimiters). There is no way to write a value that is just `"`, except by switching to another quote character.

`lino-objects-codec`'s `formatIndented` writes empty values exactly this way (`a ''`), so its output does not read back through the `Parser`.

## Workaround

hive-mind never writes an empty quoted string. It encodes `''` as a `~b64_` reference, and it decodes and re-encodes every state file before it writes it, failing if anything changed (`src/bot-state-lino.lib.mjs`, link-assistant/hive-mind#4143).

## Suggested fix

1. A quoted reference must not run past the end of the line unless the line actually opens a multi-line string. An empty `""`/`''` followed by a newline should close immediately, the same as `""` followed by `)` or a space does today.
2. Specify how an N-quote delimiter interacts with doubled quotes (`""""`, `""""""`) and add both readings to the cross-language test suite. Also document the shortest way to write a value that is only a quote character.
3. Add a property test: format any string with the reference formatter, parse it back, and get the same string, in key and value positions and in both indented and parenthesized forms.
