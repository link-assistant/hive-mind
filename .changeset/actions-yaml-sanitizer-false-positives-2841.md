---
'@link-assistant/hive-mind': patch
---

The credential sanitizer no longer treats GitHub Actions workflow YAML as secrets (#2841). The `id-token` permission scope (`read`, `write` or `none`), `${{ … }}` expressions such as `${{ secrets.GITHUB_TOKEN }}` (unquoted, quoted, backticked, after `--token` or in a query string), runner variable names such as `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, and empty inline-code keys like `` `password:` `` are now left alone, and the closing backtick of inline code is no longer eaten. An expression that embeds a literal, such as `${{ 'value' }}`, is now masked whole instead of leaking the literal. The `--development-log` rescan, staging and commit now cover only this session's `sessions/<id>/` directory, so the AI's own case-study files no longer cause the session log to be discarded. When the rescan does block publication, it reports `path:line (rule: …)` without the matched text.
