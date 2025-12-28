---
'@link-assistant/hive-mind': patch
---

Fix fork sync authentication in non-interactive environments (Issue #1017)

Replace direct `git push` commands with `gh repo sync` to fix authentication issues in Docker containers and CI/CD pipelines. The error "fatal: could not read Username for 'https://github.com': No such device or address" occurred because native git commands fail in non-TTY environments where credentials aren't pre-configured.

The `gh repo sync` command uses GitHub's authenticated API directly, bypassing the need for git credential helpers, making fork synchronization work correctly in:

- Docker containers without TTY
- CI/CD pipelines
- Non-interactive environments
