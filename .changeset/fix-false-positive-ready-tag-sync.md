---
'@link-assistant/hive-mind': patch
---

fix: prevent false positive ready tag sync by using issue timeline API (Issue #1413)

Previously, `syncReadyTags()` used a GitHub full-text body search to find PRs linked to an issue:

```js
gh pr list --search "in:body closes #1411 OR fixes #1411 OR resolves #1411"
```

This caused a false positive: PR #843 matched because `1411` appeared as a source code line reference inside its body, not as a genuine issue-closing keyword.

Now uses the GitHub issue timeline API (`GET /repos/{owner}/{repo}/issues/{issue_number}/timeline`) to find PRs with genuine `cross-referenced` events, which is the same data GitHub uses to auto-close issues when PRs are merged.
