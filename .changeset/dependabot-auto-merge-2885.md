---
'@link-assistant/hive-mind': minor
---

Support auto-merging Dependabot version bump pull requests (#2885). `/merge <repository> --dependabot` now also queues open Dependabot PRs, which never carry the `ready` label, and merges them sequentially with the usual CI gate. With `--auto-resolve`, Dependabot PRs whose CI fails are handed to `/solve <pr> --auto-merge` instead of being left open. `/fix --update-all-dependencies` merges open Dependabot PRs the same way before creating its issue, records which ones landed or stayed open in that issue, and can be turned off with `--no-auto-merge-dependabot`.
