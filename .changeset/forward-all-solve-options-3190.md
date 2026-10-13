---
'@link-assistant/hive-mind': patch
---

Every original `solve` option now survives the auto-resume/auto-restart relaunch after a usage-limit reset. Previously, the relaunch rebuilt its command line from a short allowlist, so `--auto-merge`, `--think`, `--language`, `--disable-report-issue`, `--no-tool-check` and every other option were silently dropped. Forwarding now goes through one definition-driven mechanism (`src/cli-option-forwarding.lib.mjs`), which is also used for the printed manual-resume commands, the "did you mean the issue?" suggestion and hive → solve. An explicit `--model sonnet` is no longer lost on resume, an implicit fallback model is no longer pinned, and hive no longer forwards the internal `--previous-anthropic-cost` (#3190).
