## Summary

`formatIndented` (lino-objects-codec 1.1.0, JS) is the readable, parenthesis-free format, but it has two problems for state files that people read and edit:

1. **Its output does not always read back through the links-notation `Parser`.** It writes empty strings as `''` and values that start with `#` bare. links-notation 0.31.8 reads two `a ''` lines as one value spanning both lines, and drops `#release` as a comment (link-foundation/links-notation#443 and link-foundation/links-notation#444). `parseIndented` reads them back correctly, so the problem only appears when another LiNo reader (link-cli, a different language binding, a person's tooling) reads the file.
2. **Nested objects are written as separate top-level sections with generated ids** (`hive_mind_state_tasks_q-1_args:`) instead of being nested under their parent. A reader has to jump between sections. The generated ids also become part of the data a person sees, and they can collide with real keys.

## Reproduction

```js
import { formatIndented, parseIndented } from 'lino-objects-codec'; // 1.1.0
import { Parser } from 'links-notation'; // 0.31.8
const show = l => (l && typeof l === 'object' ? (l.values?.length ? [l.id, ...l.values.map(show)] : l.id) : l);
const obj = { tasks: { 'q-1': { args: ['--model', '', '#x'] } }, a: '', b: '' };
const text = formatIndented({ id: 'hive_mind_state', obj });
console.log(text);
console.log(JSON.stringify(parseIndented({ text }).obj)); // round-trips
console.log(JSON.stringify(new Parser().parse(text).map(show))); // does not
```

Output:

```
hive_mind_state:
  tasks hive_mind_state_tasks
  a ''
  b ''

hive_mind_state_tasks:
  q-1 hive_mind_state_tasks_q-1

hive_mind_state_tasks_q-1:
  args hive_mind_state_tasks_q-1_args

hive_mind_state_tasks_q-1_args:
  --model
  ''
  #x

{"tasks":{"q-1":{"args":["--model","","#x"]}},"a":"","b":""}

[["hive_mind_state",[null,"tasks","hive_mind_state_tasks"],[null,"a","\n  b "]],["hive_mind_state_tasks",[null,"q-1","hive_mind_state_tasks_q-1"]],["hive_mind_state_tasks_q-1",[null,"args","hive_mind_state_tasks_q-1_args"]],["hive_mind_state_tasks_q-1_args","--model",""]]
```

The links-notation `Parser` reads `a` as `"\n  b "`, loses `b`, and drops `#x`.

## Expected

An option such as `formatIndented({ id, obj, nested: true })` / `parseIndented({ text, nested: true })` that keeps children under their parent:

```
hive_mind_state:
  intake:
    state draining
  tasks:
    q-1:
      args:
        --model
        ~b64_
        "#x"
```

Every value it writes must parse back unchanged with the plain links-notation `Parser`, not only with `parseIndented`.

## Workaround

hive-mind has its own small formatter for this nested style (`src/bot-state-lino.lib.mjs`, link-assistant/hive-mind#4143). Every file is checked by parsing it back with links-notation before it is written. Empty strings and other unsafe values use a `~b64_` reference.

## Suggested fix

1. Add the nested mode above, with the same quoting rules as the rest of the codec.
2. Quote (or base64-encode) values that the links-notation `Parser` would misread: an empty string at the end of a line, and a leading `#`.
3. Add a round-trip test that parses the `formatIndented` output with `links-notation`'s `Parser`, not only with `parseIndented`.
