---
'@link-assistant/hive-mind': patch
---

Stop overstating pull request status on external repositories (issue #2295): do not post "Ready to merge — All CI checks have passed" while fork workflow runs wait for maintainer approval (and never auto-merge then), make the `--auto-merge` fork/no-permission notice stop claiming readiness, keep explicit partial-scope references such as "Part of #N" instead of appending "Fixes #N", keep a pull request that a maintainer converted to draft in draft across sessions, tell the AI to respect maintainer drafts and to use "Part of #N" for partial work, and label the cost estimate as informational. Adds the case study in `docs/case-studies/issue-2295`.
