---
'@link-assistant/hive-mind': patch
---

Fix CI/CD false positives found in issue #4149:

- Read-only `gh` calls are retried when GitHub cuts its reply off (`unexpected end of JSON input`). Writes are still never retried on it, because the request may already have been applied.
- The Formal AI draft `report-checks` poll tolerates up to 10 failed polls in a row instead of failing on the first.
- `dispatch-checks` takes the dispatched run from the dispatch response (`return_run_details`), so a run that GitHub has created but does not list yet no longer fails the draft.
- The Broken Link Checker confirms throttled gist, issue, pull request and commit links through the GitHub API, as it already did for blob/tree pages, instead of reporting a healthy gist as broken.
- formal-ai 0.356.11, zizmor-action v0.9.2, agent-commander ^0.13.0, eslint-plugin-n ^18.6.0.
