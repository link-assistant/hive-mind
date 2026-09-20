# Case Study: Issue #1803 — `--auto-fork` mode does not work

- Issue: https://github.com/link-assistant/hive-mind/issues/1803
- Pull Request: https://github.com/link-assistant/hive-mind/pull/1804
- External evidence: https://github.com/labtgbot/telegram-claude-agent/pull/4#issuecomment-4463389730
- Branch: `issue-1803-854359847a6b`

## TL;DR

When `solve` continues an existing fork PR, it built the fork's full name
by re-applying the `--prefix-fork-name-with-owner-name` option to
`forkRepoName` (which already comes from the PR's `headRepository.name`).
For forks whose name already contained the prefix (e.g.
`labtgbot-telegram-claude-agent`), the result was a _doubled_ prefix
(`konard/labtgbot-labtgbot-telegram-claude-agent`) — a fork that doesn't
exist. Lookup returned 404 and the run failed even though `--auto-fork`
was supposed to find the user's existing fork.

The fix: when `forkRepoName` is known from PR head data, treat it as
authoritative. The prefix flag controls fork _creation_ (giving the
local fork a unique name on the user's account), not fork _lookup_.

## Contents

- `README.md` — this overview
- `timeline.md` — what happened, in order
- `requirements.md` — explicit requirements pulled from the issue body
- `root-causes.md` — analysis of why it broke
- `solution-plans.md` — fix options, the one we picked, and why
- `data/` — raw evidence (issue dump, PR dump, external comment)

## Reproduction (pure logic)

`experiments/issue-1803-repro-double-prefix.mjs` simulates the buggy and
fixed code paths against the concrete scenario from the failing log and
asserts both behaviors. Run with:

```sh
node experiments/issue-1803-repro-double-prefix.mjs
```

## Automated regression test

`tests/test-issue-1803-auto-fork-double-prefix.mjs` covers both the
source shape of the fix and the logic, so future refactors can't silently
re-introduce the doubled-prefix lookup. Run with:

```sh
node tests/test-issue-1803-auto-fork-double-prefix.mjs
```
