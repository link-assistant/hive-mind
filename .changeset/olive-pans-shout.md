---
'@link-assistant/hive-mind': patch
---

Fix false positives and false negatives in CI/CD (issue #2082). Release and Helm scripts now fail on non-zero exit codes instead of silently continuing, npm publish verification retries registry propagation without republishing, version bumps retry a rejected push on top of the new remote HEAD, shell test assertions fail the build, every workflow job declares a timeout, and jobs use `!cancelled()` so concurrency cancellation is respected. Releases on main now queue rather than cancel, so a run cannot be interrupted between publishing to npm and pushing the version bump.

Linting now also covers the `tests/` tree, which `npm run lint` and `eslint.config.mjs` both excluded — the lint job reported success while never reading the largest source tree in the repository. Enabling it surfaced real defects across 59 files, including `assert.match` regexes with unescaped literal indentation that made assertions pass for the wrong reason.

Stops leaking `CLAUDE_CODE_EFFORT_LEVEL` from the parent shell into the Claude process. `getClaudeEnv()` builds the child environment from `process.env` and sanitised an inherited `MAX_THINKING_TOKENS`, but not the effort level, so any path that computed no level passed the parent's value through — giving `haiku` an effort level it does not support, and `--think off` one despite thinking being disabled. Since Claude Code exports this variable, the leak applied whenever hive-mind ran under it. The emitted effort level is now a function of the selected model and think level only.
