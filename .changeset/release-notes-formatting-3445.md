---
'@link-assistant/hive-mind': patch
---

GitHub release notes keep the Markdown structure of the changeset (issue #3445). The formatter no longer trims every line, so later paragraphs and nested lists of a changeset stay inside its list item, as in `CHANGELOG.md`. It also keeps every `### Major/Minor/Patch Changes` section, the first `- <hash>:` marker, text after `---`, a literal `\n` and trailing quotes. Major and Minor releases are now formatted too, and `--verbose` logs what was found. The release section is taken from the whole `## <version>` heading line, so `2.3.1` no longer matches `2.3.10`, and a multi-line manual release description is indented in `CHANGELOG.md` like a changeset.

The publication sanitizer no longer masks code and option names in release notes: `false`, `…` and `<placeholder>` values, identifiers such as `KNOWN_LOCAL_TOKEN_ENV_VARS`, and options such as `--tokens-budget-stats` or `--max-tokens`. Real credentials next to them are still masked.

`scripts/repair-release-notes.mjs` rebuilds published releases from `CHANGELOG.md`. It is a dry run by default; `--apply` updates the releases and `--backup-dir` saves the old bodies. It was used to repair the 366 damaged releases.
