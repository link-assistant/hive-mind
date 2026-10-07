---
'@link-assistant/hive-mind': patch
---

Fix the CI/CD false negatives found on `main` (issue #2625). The dependency-freshness gate now blocks pull requests only and warns on pushes. The fixture cleanup reports ruleset-retained branches as retained, not as errors. `release.yml` can be dispatched with `mode=checks` alone. The Formal AI draft creates its label when it is missing. Log uploads no longer retry a token that cannot create gists. `solve --log-dir` now actually writes the session log into that directory. The default Agent model moves from the withdrawn `opencode/nemotron-3-super-free` to `kilo/nemotron-3-super-free`. Result verification works with integration tokens and prints the real failure reason. Command-stream is bumped to 2.0.0 and Sentry to 11.5.0.
