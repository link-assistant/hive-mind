---
'@link-assistant/hive-mind': patch
---

fix: prevent infinite CI waiting loop when workflows complete with action_required (Issue #1466)

- Detect when all workflow runs completed with non-executing conclusions (action_required, cancelled, stale, skipped) and treat as "CI not triggered" instead of waiting indefinitely for check-runs that will never appear
- Add verbose log interceptor (setupVerboseLogInterceptor) to capture [VERBOSE] console.log output in log files, fixing the discrepancy between terminal and log file output
- Add case study with root cause analysis and timeline reconstruction from 5 production log files
- Add 14 unit tests covering action_required handling, non-executing conclusions, race conditions, and edge cases
