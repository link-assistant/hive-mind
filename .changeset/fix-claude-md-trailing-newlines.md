---
'@link-assistant/hive-mind': patch
---

fix: add trailing newlines to generated CLAUDE.md files and prompts

Ensures all automatically generated CLAUDE.md files and prompt strings comply with POSIX text file standards by adding trailing newlines. This fix prevents linter warnings and eliminates the need for manual fixes in subsequent pull requests.

Changes:
- Modified `src/solve.auto-pr.lib.mjs` to add trailing newline to CLAUDE.md template
- Updated all prompt builder files (`agent.prompts.lib.mjs`, `claude.prompts.lib.mjs`, `codex.prompts.lib.mjs`, `opencode.prompts.lib.mjs`) to append `\n` to return values
- Added comprehensive case study documentation in `docs/case-studies/issue-971/`

Fixes #971
