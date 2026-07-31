---
'@link-assistant/hive-mind': patch
---

Stop `/task --ci-cd` and `/fix --ci-cd` from listing the same workflow many times in the generated issue (issue #2125). When the latest default-branch commit has no workflow runs — typical for release commits — the collector falls back to the recent runs of the default branch, which span many commits; every one of them became a table row, so `link-assistant/agent#287` listed two workflows twenty times and reported "20 (9 not passing)". `dedupeRunsByWorkflow()` now keeps only the most recent run of each workflow (by `workflow_id`, then `path`/`name`, resolved with `created_at`/`run_attempt`/`id`), the failure summary counts the same deduplicated set, and the branch-fallback table gained a Commit column because its rows can come from different commits. The fallback fetches 100 runs instead of 20 so a rarely-run workflow still appears after collapsing, and `prepareCiCdIssue()` logs how many runs it collapsed.
