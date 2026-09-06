---
'@link-assistant/hive-mind': patch
---

CI/CD guide, principle 10: a serialised writer still checks out `github.sha`

The concurrency group orders main-writing jobs; it does not refresh their
working trees, so the second writer in the queue starts behind the branch and
its push is rejected as non-fast-forward. Principle 10 now says so, rules out
`ref: main` on the checkout (it publishes a tree CI never validated), and
prescribes the recovery: classify the rejection — a GH006/GH013 ruleset
rejection prints `rejected` too and can never be satisfied by a rebase — then
rebase and retry. Added to all four translations, with the pull-request
recovery cross-referenced from principle 9.
