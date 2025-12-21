---
'@link-assistant/hive-mind': patch
---

Fix workflow conditions to prevent unvalidated code from merging

Updated lint job conditions in release.yml to check all file types that Prettier formats (.mjs, .md, .json, .js), not just .mjs files. This ensures the lint check runs consistently for both pull requests and main branch, preventing formatting issues from bypassing validation. Previously, PRs changing only .md or .json files would skip lint checks, allowing unformatted code to merge and cause main branch CI failures.

Also fixed formatting issues and added comprehensive documentation:

- Fixed Prettier formatting errors in two files that caused main branch CI failure
- Added case study analysis (docs/case-studies/issue-958/ANALYSIS.md) with root cause analysis and timeline reconstruction
- Created branch protection policy guide (docs/BRANCH_PROTECTION_POLICY.md) with required status checks specification and configuration instructions
