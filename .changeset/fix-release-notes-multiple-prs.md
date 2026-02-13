---
'@link-assistant/hive-mind': patch
---

Fix release notes to show ALL related pull requests when multiple PRs are merged before a release (Issue #1271)

- Extract ALL commit hashes from changelog entry (not just the first one)
- Look up PRs for each commit hash via GitHub API
- Display all unique PR numbers in release notes (e.g., "Related Pull Requests: #1268, #1270")
- Use plural "Pull Requests" label when multiple PRs are found
- Add comprehensive case study documentation in docs/case-studies/issue-1271/
