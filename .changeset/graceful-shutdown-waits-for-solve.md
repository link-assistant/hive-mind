---
"@link-assistant/hive-mind": patch
---

Fix graceful shutdown so CTRL+C / `--stop` fully waits for every in-flight `/solve` to finish before hive exits. `hive` now delegates signal handling to a single owner (resolving a double SIGINT-handler race that called `process.exit(130)` and cut the wait short), spawns each solve worker in its own detached process group so the terminal's SIGINT no longer aborts solve/codex mid-task, and waits without a time cap (a second CTRL+C force-stops in-flight workers via their process group). Worker stderr is no longer mislabeled as `ERROR` — the child exit code remains the authoritative failure signal.
