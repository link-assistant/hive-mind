---
'@link-assistant/hive-mind': patch
---

fix(merge): `/merge` now stops when the target branch CI fails (#2404). The queue re-checks the default branch's CI conclusions before every merge and after every wait, instead of only waiting for the runs to finish. A HEAD commit without CI of its own, such as a release version bump pushed with `GITHUB_TOKEN`, is judged by the newest ancestor that has push CI. The queue also stops, rather than merging blindly, when main CI is still running after the wait times out.

`scripts/wait-for-npm.mjs` now also waits until the version's tarball can be downloaded, not only until `npm view` returns the version. The arm64 Docker build that turned main red failed with a tarball 404 three minutes after the metadata became visible.
