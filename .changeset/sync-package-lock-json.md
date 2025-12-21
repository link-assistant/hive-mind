---
'@link-assistant/hive-mind': patch
---

Fix package-lock.json sync in changeset version bump flow

- Add `npm install --package-lock-only` after `npm run changeset:version` in version-and-commit.mjs
- Ensures package-lock.json stays in sync with package.json during changeset-based releases
- Fixes issue where version bumps only updated package.json
