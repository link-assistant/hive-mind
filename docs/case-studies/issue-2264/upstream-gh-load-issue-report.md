# Upstream report: published `gh-load-issue` executable cannot start

Submitted as
[link-foundation/gh-load-issue#18](https://github.com/link-foundation/gh-load-issue/issues/18)
on 2026-09-20.

## Summary

The npm `latest` artifact (`gh-load-issue@0.3.2`) cannot start on Linux. Its
shell/JavaScript polyglot launcher executes `//` as a shell command and then
tries to interpret ESM imports as shell syntax. This also prevents consumers
from reading `gh-load-issue --version`.

This was found while implementing dependency/runtime freshness for
link-assistant/hive-mind#2264. The current `main` branch already uses the
working `#!/usr/bin/env bun` shebang, but that fix has never reached npm:
`0.3.2` was published on 2025-12-26, while the Bun-only shebang commit
`dabcb456` landed on 2025-12-27.

## Reproduction

Environment: Linux, Bun 1.3.9, Node 24.21.0.

```console
$ bun install -g gh-load-issue@0.3.2
$ sed -n '1,3p' "$(bun pm bin -g)/gh-load-issue"
#!/usr/bin/env sh
':'; // # ; exec "$(command -v bun || command -v node)" "$0" "$@"

$ gh-load-issue --version
/home/box/.bun/bin/gh-load-issue: 2: //: Permission denied
/home/box/.bun/bin/gh-load-issue: 5: import: not found
...
/home/box/.bun/bin/gh-load-issue: 17: Syntax error: "(" unexpected
$ echo $?
2
```

The same failure reproduces through npm without relying on an existing global
installation:

```console
$ npx --yes --package gh-load-issue@0.3.2 -- gh-load-issue --version
.../node_modules/.bin/gh-load-issue: 2: //: Permission denied
.../node_modules/.bin/gh-load-issue: 5: import: not found
...
```

## Root cause

For JavaScript, `//` comments out the rest of line 2. For POSIX shell, however,
the semicolon before `//` ends the `:` no-op and makes `//` the next command;
the later `#` is never reached. The shell therefore never reaches `exec bun`.

The repository's current `gh-load-issue.mjs` begins with
`#!/usr/bin/env bun`, which removes this defect. The npm registry and GitHub
release still point to 0.3.2, so consumers continue to receive the older broken
artifact even though the source fix is on `main`.

## Suggested fix and regression coverage

1. Publish the pending Bun-first changes as a new npm version (the repository
   already contains `.changeset/gh-cli-default.md`).
2. In release CI, install the just-packed tarball into a clean temporary prefix
   and execute both `gh-load-issue --version` and `gh-load-issue --help` through
   the generated bin link. Testing the source with `bun gh-load-issue.mjs` does
   not exercise the consumer entry point that failed here.
3. Verify the npm registry postcondition after publication, rather than relying
   only on the GitHub release/workflow status.

Downstream can inspect `bun pm ls -g` as a temporary version-detection fallback,
but that cannot repair the published executable itself.
