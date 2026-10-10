---
'@link-assistant/hive-mind': minor
---

Link GitHub Docs wherever a GitHub setting is the fix (issue #2998). When a repository is not accessible or read-only, the Telegram reply and the CLI now name the GitHub account to invite, link the repository's access settings and invitation pages, and link the GitHub Docs section for inviting a collaborator (personal repositories) or giving the Write role (organizations), in the user's language. Telegram also sends an animated step-by-step GIF rendered with browser-commander; it is generated once per account and language and reused from `~/.hive-mind/guides/github-access/`. Push, merge, fork, invitation, token-scope, rate-limit and CI failures now carry the matching GitHub Docs page (protected branches, rulesets, push protection, email privacy, large files, archived repositories, SSO, maintainer edits, forking policy, Actions settings) in the CLI log, merge resolutions and the comments posted on GitHub. See `docs/GITHUB-ACCESS.md`.
