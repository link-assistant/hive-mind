---
"@link-assistant/hive-mind": patch
---

Handle the auto-PR placeholder being listed in the target repository's `.gitignore` without aborting the whole run (issue #1825). Previously `git add .gitkeep` exited non-zero and the solver threw `Failed to add .gitkeep` → `FATAL ERROR: PR creation failed`. Now, when the placeholder (`.gitkeep` or `CLAUDE.md`) is gitignored, the solver by default prints a clear, environment-agnostic root-cause explanation and stops cleanly instead of forcing the commit. Two opt-in flags are added (usable with both `solve` and `/solve`): `--remove-git-keep-from-git-ignore` removes the literal placeholder entry from `.gitignore` first and then commits normally, and `--force-git-keep-commit` commits the placeholder anyway with `git add -f`.
