---
'@link-assistant/hive-mind': patch
---

Fix CI/CD check differences between pull request and push events

Changes:

- Make lint job independent of changeset-check (runs based on file changes only)
- Allow docs-only PRs without changeset requirement
- Handle changeset-check 'skipped' state in dependent jobs
- Fix unformatted markdown files in case studies
- Add case study documentation for issue #1023
