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
- creates the remediation issue reusing the title and description of the standard
  prompt (web-capture#139) exactly, minus the paragraphs that `--development-log`
  and `--deep-analysis` already inject into the AI prompt — a paragraph is dropped
  only when every option providing it is passed, so a partial overlap never
  silently removes an instruction. The issue is created as type `Bug`
  (best-effort, since issue types are org-scoped) because that is what makes the
  deep-analysis omission valid, and links to `docs/CI-CD-BEST-PRACTICES.md`;
- hands the issue off to `/solve --development-log --deep-analysis --auto-merge`,
  forwarding every option `/fix` does not consume itself (e.g. `--tool`,
  `--model`, `--think`);
- supports `--dry-run` (preview the issue) and `--no-solve` (create only).

The command is also available from the Telegram bot as `/fix <repository>`
(`--ci-cd` is implied), toggleable with `--no-fix` / `TELEGRAM_FIX=false` and
documented in all four locales.

Also adds the PHP template
(`link-foundation/php-ai-driven-development-pipeline-template`) to
`docs/CI-CD-BEST-PRACTICES.md` and documents the new "Automatic CI/CD
Remediation" flow in all four languages (en/zh/hi/ru).
