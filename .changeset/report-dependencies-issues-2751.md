---
'@link-assistant/hive-mind': minor
---

Enable dependency issue reporting by default with --update-all-dependencies, and
add --report-dependencies-issues for independent control. Generated dependency
issues and all solver tools ask for upstream reports of shared logic, duplicated
code, missing features and bugs requiring workarounds, while allowing local
workarounds to keep the pull request moving. Preserve explicit opt-outs through
/fix and Telegram /task issue generation and solve handoffs.

Refresh the paired Sentry SDK packages to 11.6.0 to satisfy the dependency
freshness gate after the new upstream release.
