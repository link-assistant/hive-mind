---
'@link-assistant/hive-mind': patch
---

Fix Docker Publish jobs being skipped after npm publish

Added explicit shell-based output passthrough step for `published` output in both `release` and `instant-release` jobs. This ensures reliable output propagation to dependent jobs (`docker-publish` and `docker-publish-instant`).

Root cause: Node.js `appendFileSync` to `GITHUB_OUTPUT` was not reliably propagating outputs to dependent jobs. The fix uses a dedicated shell step to echo outputs, which is proven to work correctly.

Also added debug logging to `setOutput` function in `publish-to-npm.mjs` and `version-and-commit.mjs` scripts.
