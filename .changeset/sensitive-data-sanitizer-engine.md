---
'@link-assistant/hive-mind': patch
---

Fix the credential sanitizer masking the scheme word instead of the credential in `Authorization: token <value>` (and any other scheme), which published the value; shell expressions such as `$(gh auth token)` stay as they are (#3739). All sanitizers (terminal, logs, publication, residual check) now run on @link-foundation/sensitive-data-sanitizer instead of Hive Mind's own rule list, masking credentials only; known local values (credential environment variables, every gh hosts.yml token, `gh auth token`) are collected by the library, which also fixes the `gh auth status` collector that found no token on current gh versions (#3740). Remaining library differences have workarounds linked to their upstream issues.
