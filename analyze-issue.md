# Issue #1092 Analysis: Silent Ignoring of "-- model" (with space)

## The Problem

When a user types `-- model` (with a space between the dashes) instead of `--model`,
the system silently ignores it and uses the default model instead of producing an error.

## Why This Happens

### Argument Parsing in Shell

When a shell receives the command:

```bash
solve https://github.com/owner/repo/issues/1 -- model sonnet
```

It parses this as:

- `https://github.com/owner/repo/issues/1` (positional arg)
- `-- model` (single string, NOT a flag)
- `sonnet` (positional arg)

The `"-- model"` string has a space in it, so it's not recognized as a flag by yargs.

### Yargs Behavior with .strict()

Yargs `.strict()` mode only rejects:

1. Unknown OPTIONS (flags that start with `-` or `--`)
2. Unknown ARGUMENTS that look like flags

It does NOT reject:

- Positional arguments that look similar to flag names
- Strings like `"-- model"` (which are treated as regular positional arguments)

So when yargs sees `"-- model"` as a positional argument, it:

1. Doesn't match it to `--model` option
2. Doesn't throw an error because it's not in strict "option" format
3. Silently ignores it
4. Uses the default model value

## The Flow

1. User types: `solve <url> -- model sonnet`
2. Shell parses as: `['<url>', '-- model', 'sonnet']`
3. Yargs receives: `{ _: ['<url>', '-- model', 'sonnet'] }`
4. Yargs strict mode checks: Is this an unknown OPTION? No.
5. Yargs silently accepts the positional arguments
6. Model defaults to 'sonnet'
7. User sees no error, but their `--model` flag was ignored

## Solution Approaches

1. **Detect spaced flag patterns**: Check if any positional arguments match the pattern
   `-- <option-name>` where option-name is a known flag

2. **Validate positional arguments**: After parsing, check if the remaining positional
   arguments look like mistyped flags (start with -- or -)

3. **Improve error message**: When detecting such patterns, suggest the correct format

## Key Code References

- `/src/solve.config.lib.mjs`: Contains yargs configuration and argument parsing
- `/src/option-suggestions.lib.mjs`: Already has logic for suggesting similar options
- `/src/model-validation.lib.mjs`: Validates model names

The current `.strict()` mode in solve.config.lib.mjs (line 316) only catches malformed
OPTIONS, not these kinds of subtle positional argument errors.
