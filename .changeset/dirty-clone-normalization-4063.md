---
'@link-assistant/hive-mind': minor
---

A fresh clone with uncommitted changes no longer stops `solve` with `Repository has uncommitted changes after clone` (issue #4063). The trigger was a repository whose committed bytes do not match its own `.gitattributes`, such as a CRLF `mvnw.cmd` committed under `text eol=crlf`.

- New `--uncommitted-changes-after-clone` option:
  - `warn-ai` (default): the run continues, and only the AI is told, in its regular user prompt (never in the system prompt). The AI gets the exact `git status` output and how to fix the cause, for example with `git add --renormalize`. Every tool gets this, in new and continued sessions, and the user sees it only with `--verbose`.
  - `warn-user`: continue and log a warning for the user.
  - `warn-ai-and-user`: tell both.
  - `ignore`: continue silently.
  - `fail`: stop the run, as before.
- New `--neutralize-checkout-conversion-artifacts` option, on by default: files whose bytes equal the commit are kept out of `git status` and the pull request by unsetting their content conversion in the clone-local `.git/info/attributes`. `--no-neutralize-checkout-conversion-artifacts` turns this off.
- `--verbose` logs the attribute and line-ending diagnostics.
- The changes already present right after the clone are no longer repeated as "uncommitted changes" restart feedback.

Also, for the CI dependency freshness gate: `secretlint`, `@secretlint/core` and `@secretlint/profiler` are updated to v14, `@link-foundation/sensitive-data-sanitizer` to 0.23.0 and `links-notation` to 0.31.6. Secretlint v14 ships the recommended preset in `@secretlint/core/builtin`, and its `@secretlint/secretlint-rule-preset-recommend` package is no longer published. Secret scanning now loads the preset from there, with the same rule ids.
