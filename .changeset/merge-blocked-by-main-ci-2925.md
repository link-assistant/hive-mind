---
'@link-assistant/hive-mind': minor
---

`/merge` now stops cleanly when CI/CD on the default branch is red or cannot be confirmed green (issue #2925): every remaining planned merge is shown as ⏭️ skipped with the reason, the message says that CI/CD on the default branch must be fixed first for `/merge` to work and how (`/fix <repository> --ci-cd`), runs still queued on the default branch are listed, and the doubled `Error: Error:` prefix is gone (the explanation is also shown without `--verbose`). New `/merge --auto-fix-ci-cd` starts `/fix --ci-cd` itself when the default branch is red. New `--fix-ci-cd` on `/solve` and every alias (`/do`, `/continue`, `/claude`, `/codex`, `/opencode`, `/agent`, `/qwen`, `/gemini`) starts the same session as `/fix --ci-cd` when given a repository or its issues listing.
