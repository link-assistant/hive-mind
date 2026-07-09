---
"@link-assistant/hive-mind": patch
---

Fix false-positive npm releases (issue #2028). `setup-npm.mjs` now pins npm to the 11.x line and validates the result instead of installing `npm@latest` (which pulled in npm 12.0.0, whose sigstore regression crashes provenance publishes — npm/cli#9722). `publish-to-npm.mjs` no longer trusts the publish command's exit status alone: it observes the real exit code, scans output for failure patterns, and verifies the version is actually live on npm before reporting success, so a failed publish can no longer be reported as a successful release. Added `sanitize-npm-userconfig.mjs` to remove the deprecated `always-auth` npm warning from release logs.
