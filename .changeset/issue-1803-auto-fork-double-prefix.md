---
'@link-assistant/hive-mind': patch
---

Fix `--auto-fork` mode failing when continuing an existing fork PR whose
fork name already contained the upstream-owner prefix. `setupRepository`
in `solve.repository.lib.mjs` was applying the
`--prefix-fork-name-with-owner-name` option to `forkRepoName` (which is
the authoritative head repo name from the PR's `headRepository.name`),
producing a doubled prefix like
`konard/labtgbot-labtgbot-telegram-claude-agent` and a 404 lookup. The
prefix option now only controls fork *creation*, not fork *lookup*:
when `forkRepoName` is present, the expected fork is
`${forkOwner}/${forkRepoName}` and no alternate-name fallback is
attempted. Resolves #1803.
