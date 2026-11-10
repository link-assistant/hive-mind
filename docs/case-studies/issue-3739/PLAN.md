# Completion plan for PR #3741

Objective: complete issues #3739 and #3740, all open sanitization issues identified in the November 10 review, and every applicable review requirement in this PR. Keep credentials private, preserve complete readable logs, and leave the PR unmerged.

## Requirement inventory (recorded before verification)

- [ ] #3739: preserve every Authorization scheme, mask its credential, and preserve shell expressions.
- [ ] #3740: use the latest published sensitive-data-sanitizer as the engine at every integration point, remove redundant rules, retain independent verification and fail-closed publication.
- [ ] #3740: preserve credentials-only policy, local environment/hosts.yml/keyring discovery, package-name and token-accounting exemptions, encoded credentials, bounded workers and the 8 MiB file-stream hold cap.
- [ ] Latest-library audit: read the fixes to upstream #131–#141, reproduce the required behavior, remove obsolete workarounds, report any remaining gaps upstream with synthetic reproducers and implement tested workarounds here.
- [ ] #3747: eliminate quadratic trailing-base64 matching and repeated full-buffer newline searches in both stream paths; verify bounded image-line and small-write wrapped-base64 cases without losing content or credentials.
- [ ] #2841: preserve Actions permissions and expressions; identify residual file/line/rule; sanitize AI-created development-log evidence without discarding the session.
- [ ] #2837: apply the later credentials-only clarification in its comments and #3740 rather than the superseded request to hide account identifiers; verify realistic SDK/OTEL logs retain identifiers and mask credentials.
- [ ] Audit #2647 (secret configuration on argv) and #3951 (embedded deployment example) to establish whether the affected sources are in this repository and address applicable credential-publication paths.
- [ ] Review every issue comment, PR conversation comment, inline comment and review; inspect any required sub-issues and related current implementations.
- [ ] Keep all affected documentation, translations, tracing (off by default) and changesets consistent.
- [ ] Add minimal reproducing regression tests and run focused checks sequentially; save substantial output to files; use CI for full suites/native builds.
- [ ] Merge current main without rewriting history; review the complete PR diff for scope and regressions; commit atomic changes and push only issue-3739-dd36d9843cea.
- [ ] Update PR title/description, reproduction/validation evidence and positive closing references for every completed required issue; check all current-commit CI workflows, clean working tree, and mark PR ready.

## Discovery record

All 157 open issues were downloaded with pagination and filtered across titles and bodies. Direct sanitizer issues: #3739, #3740, #3747, #2841 and #2837. Adjacent credential exposure issues: #2647 and #3951. Other matches concern unrelated deployment, recovery, resource use, key-storage architecture or log attachment and are outside sanitizer behavior.

The issue and PR conversation were read in full; there are no inline review comments or submitted reviews. Issues #3740, #3747 and #2841 have no comments. #2837 has two comments, including the later credentials-only clarification; #2647 has a later confirmation. #3951 has no comments. Library release 0.21.0 is the latest published release at discovery; all upstream #131–#141 issues are closed. These facts establish work to verify, not completion.
