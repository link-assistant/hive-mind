## Summary

`clink --in` (and its aliases `--import`, `--lino-input`) rejects any LiNo line nested deeper than 64 levels:

```
Error: Parse error: Nesting too deep at line 1, column 199: nesting depth exceeds the maximum of 64
```

The limit comes from the links-notation `ParserConfig` default. It is documented for the binary protocol (`docs/protocol/binary-links-notation.md`: "LiNo nesting depth | 64") and for checked queries, but not for `--in`. There is also no option to raise it, although `parser::parse_with_max_depth` exists in the library.

A program that writes a list as nested pairs (`(item1 (item2 (item3 … end)))`) runs into this as soon as the list grows. In hive-mind, a bot state with about 50 tasks failed to import. `--out` never produces such documents, because every exported line has depth 1. So the limit only bites generated or hand-written input, and the error surfaces late, in production, once data grows.

## Reproduce (clink 3.2.1 and 3.1.2, Linux x86_64)

```bash
for depth in 63 64 65; do
  python3 -c "
s = 'e'
for _ in range($depth - 1): s = f'(a {s})'
print(f'(root: r {s})')" > in.lino
  rm -f s.*
  clink --db s.links --in in.lino; echo "depth=$depth exit=$?"
done
```

Output:

```
depth=63 exit=0
depth=64 exit=0
Error: Parse error: Nesting too deep at line 1, column 199: nesting depth exceeds the maximum of 64
depth=65 exit=1
```

The store is left unchanged, which is good.

## Workaround

Keep every input line under 64 levels by naming inner links and referring to them by name. Named links may be defined on separate lines, before or after their use:

```
(~c1: item40 (item41 (… end)))
(root: r (item1 (item2 (… (item39 ~c1)))))
```

hive-mind now splits deep lists into content-addressed named links (`~c<sha256>`), so every line nests at most 32 levels (link-assistant/hive-mind#4143).

## Suggested fix

1. Document the 64-level limit for `--in`/`--import`, and for the `import_lino_text`/`import_lino_file` library APIs, in the README options table, next to the existing binary-protocol limit.
2. Optionally add `--max-depth <N>` (or `--in-max-depth`) that passes the value to `parse_with_max_depth`. It would be bounded, as the binary decoder's limits are, so input can't overflow the stack. This would let users import legitimately deep documents without rewriting them.

Found while checking the latest releases for link-assistant/hive-mind#4143. Repro script: https://github.com/link-assistant/hive-mind/blob/issue-4143-d257ff1e57bb/experiments/issue-4143/clink-in-nesting-limit.sh
