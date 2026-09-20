# GitHub REST Issues API behavior

- Source: <https://docs.github.com/en/rest/issues/issues#list-repository-issues>
- Accessed: 2026-09-20
- Publisher: GitHub (primary documentation)

GitHub documents that the repository issues endpoint can return both issues
and pull requests. Entries that represent pull requests contain a
`pull_request` property.

Consequently, a Telegram preflight must not decide that a repository has work
merely because the REST response is nonempty. The implementation reuses the
repository-mode preparation path, including its pull-request filtering and
selection rules, so Telegram and the CLI classify the same data consistently.
