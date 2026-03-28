---
'@link-assistant/hive-mind': patch
---

fix: reject URLs and invalid git branch names used as --base-branch (Issue #1482)

- Add `validateBranchName()` function to `solve.branch.lib.mjs` that validates branch names against git-check-ref-format rules
- Reject URLs (https://, http://, git@, ssh://) passed as --base-branch with clear error message
- Reject invalid git ref characters (spaces, ~, ^, :, ?, \*, [, ], \, control chars, .., @{)
- Add validation in `solve.config.lib.mjs` parseArguments (early catch), `solve.branch.lib.mjs` createOrCheckoutBranch (defense-in-depth), and `hive.mjs` (before forwarding to solve)
- Add 19 test cases in `tests/test-base-branch-validation.mjs`
- Add case study documentation in `docs/case-studies/issue-1482/`
