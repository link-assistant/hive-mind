---
'@link-assistant/hive-mind': patch
---

`--auto-restart-until-mergeable` no longer spends every restart on sessions that only reword the same report of a CI blocker (#2839). The no-progress check between AI sessions now compares only the commit and the working tree, so a reworded final message no longer counts as progress. Restarts for failing CI now ask the AI to fix every failing check, including checks that already fail on the default branch, because a pull request with failing CI cannot be released. When a check needs a human action, such as a missing secret or access to a private submodule, the AI is told to make the pull request's CI pass without it and to make CI on the default branch fail with an explicit message saying what a human has to do. When a failing check also fails on the head of the base branch or on the solver's placeholder commit, the prompt includes links to those runs as evidence.

Dependencies refreshed for the freshness gate: Bun 1.4.3 and start-command 0.37.0 (Docker images), and prettier 3.9.10.
