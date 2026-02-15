---
'@link-assistant/hive-mind': patch
---

fix: display skip/fail reasons in merge queue Telegram messages (#1294)

Previously, when PRs were skipped or failed during merge queue processing, the Telegram message only showed the PR number without explaining why it was skipped. This left users unable to understand what action was required to resolve the issue.

Now the merge queue displays the reason for each skipped or failed PR in both:

- Progress messages (during processing)
- Final report messages (after completion)

Example output:

```
Results:
⏭️ #1241 (Issue #1240): PR has merge conflicts
⏭️ #1257 (Issue #1256): PR has merge conflicts
```

This change follows UX best practices for error messages by:

- Showing the specific reason for each failure
- Using clear, human-readable language
- Helping users understand what action is needed
