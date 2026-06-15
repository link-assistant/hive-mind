---
'@link-assistant/hive-mind': minor
---

feat(fix): add `/fix --ci-cd <repository>` command (#1733)

`/fix --ci-cd` automatically generates and solves a CI/CD remediation issue for
a target repository:

- detects the repository's languages via the GitHub `/languages` API and selects
  the matching CI/CD templates, ordered by detected language (byte-weighted);
- inspects the latest default-branch commit and lists its CI/CD runs in the issue
  (falling back to the most recent default-branch runs when a release/tag commit
  has none of its own);
- creates the remediation issue using the standard prompt from web-capture#139,
  including a link to `docs/CI-CD-BEST-PRACTICES.md`;
- hands the issue off to `/solve --auto-merge`, forwarding every option `/fix`
  does not consume itself (e.g. `--tool`, `--model`, `--think`);
- supports `--dry-run` (preview the issue) and `--no-solve` (create only).

Also adds the PHP template
(`link-foundation/php-ai-driven-development-pipeline-template`) to
`docs/CI-CD-BEST-PRACTICES.md` and documents the new "Automatic CI/CD
Remediation" flow in all four languages (en/zh/hi/ru).
