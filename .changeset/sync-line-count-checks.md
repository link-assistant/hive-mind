---
'@link-assistant/hive-mind': patch
---

Synchronize line count checks in CI/CD

- Add ESLint max-lines rule (1500 lines) to match CI workflow check
- Extract handleClaudeRuntimeSwitch to claude.runtime-switch.lib.mjs
- Reduce claude.lib.mjs from 1506 to 1354 lines
- Add case study documentation for issue #1141

Fixes #1141
