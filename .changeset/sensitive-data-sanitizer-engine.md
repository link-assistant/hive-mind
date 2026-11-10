---
'@link-assistant/hive-mind': patch
---

Fix the credential sanitizer masking the scheme word instead of the credential in `Authorization: token <value>` (and any other scheme), which published the value; shell expressions such as `$(gh auth token)` stay as they are (#3739). All sanitizers (terminal, logs, publication, residual check) now run on @link-foundation/sensitive-data-sanitizer instead of Hive Mind's own rule list, masking credentials only; known local values (credential environment variables, every gh hosts.yml token, `gh auth token`) are collected by the library, which also fixes the `gh auth status` collector that found no token on current gh versions (#3740). Remaining library differences have workarounds linked to their upstream issues.

Upgrade the engine to 0.21.1 and remove obsolete adapter rules. Preserve masked prose, wrapped images, Markdown configuration examples, constructor syntax, encoded masks and private-key redaction with tested upstream-linked workarounds. Eliminate quadratic stream-boundary scans (#3747), retain Actions permissions and useful account diagnostics (#2837), and repair then verify AI-created development-log evidence before staging with file/line/rule diagnostics (#2841).

Keep Telegram bot credentials off the running process command line: support a private configuration file, re-exec legacy inline credential options through environment transport, retain configuration precedence, and document Helm Secrets and private files. Replace token-shaped deployment examples with explicit placeholders and check their embedded template sources (#2647, #3951).
