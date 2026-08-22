# Solution plans — Issue #1803

## Option A (chosen): trust `forkRepoName` in the lookup branch

When `forkRepoName` is provided (i.e., the PR's `headRepository.name`
was readable), build the expected fork name as
`${forkOwner}/${forkRepoName}` directly and skip the alternate-name
fallback. Only when `forkRepoName` is _not_ available do we fall back
to guessing from the base repo name + prefix option.

```js
const headRepoName = forkRepoName || repo;
const standardForkName = `${forkOwner}/${headRepoName}`;
const prefixedForkName = `${forkOwner}/${owner}-${headRepoName}`;
const expectedForkName = forkRepoName ? `${forkOwner}/${forkRepoName}` : argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
const alternateForkName = forkRepoName ? null : argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName;
```

The fallback guard becomes `alternateForkName && !argv.prefixForkNameWithOwnerName`
so the authoritative path never falls through.

**Pros:**

- One-line conceptual fix that matches what the data already says.
- Zero call-site changes (`setupRepository` signature unchanged).
- Doesn't touch fork _creation_ logic.
- Preserves the #1332 contract.

**Cons:**

- Slightly denser ternary expression. Acceptable; this branch is
  expression-heavy already.

## Option B (rejected): make the prefix flag default `false`

The prefix flag was added so user-created forks don't clash with
existing repos. Flipping the default would regress fork _creation_ for
everyone who hits a collision. Wrong layer.

## Option C (rejected): always probe both names

We could just `gh repo view` both `standard` and `prefixed` in every
case. But that doubles the GitHub API hits per run for what is
fundamentally a deterministic answer: `headRepository.name` _is_ the
fork's name. Stretching API quota to paper over a logic bug is a smell.

## Option D (rejected): change the auto-fork detection to bypass this branch entirely

When `forkOwner` is detected from PR data, we could `gh repo view`
the head's full `owner/name` (also already in PR head data) directly.
Cleaner long-term, but a larger refactor that touches `solve.mjs` and
`solve.fork-detection.lib.mjs`. Out of scope for a regression fix.

## Prior-art search

- `octokit/rest.js` and `gh pr view --json headRepository` both already
  expose `headRepository.name` and `headRepository.owner.login`. There
  is no library missing here — we already have the data.
- No off-the-shelf "fork-name resolver" exists in our tree, and we
  shouldn't introduce one for two call sites; the corrected inline
  logic is fine.
- For the wider regression-protection goal: pure-logic unit tests on
  the name-resolution function are the right shape. We mirror the
  patched logic in `tests/test-issue-1803-auto-fork-double-prefix.mjs`
  so it stays a unit-level test rather than requiring GitHub network
  access.

## Verification plan

- Reproduction: `node experiments/issue-1803-repro-double-prefix.mjs`
  asserts buggy result `konard/labtgbot-labtgbot-telegram-claude-agent`
  and fixed result `konard/labtgbot-telegram-claude-agent`.
- Regression suite: `node tests/test-issue-1803-auto-fork-double-prefix.mjs`
  — 9 tests, all green.
- Existing contract: `node tests/test-issue-1332-fork-name-from-pr-data.mjs`
  — 14 tests, all green.
- Lint: `npm run lint` clean (file stays within the 1500-line cap).
- The #1804 PR CI green-light is the final gate.

## Debug output / verbose mode

Existing logs (`Using fork: …`, `Fork tried: …`, `Fork name was guessed
from base repo name …`) were already sufficient to diagnose this from
the external comment alone. No new debug output was added; introducing
verbose-only logs would have been speculation, not data-driven.

## Related-repo reports

The external repo (`labtgbot/telegram-claude-agent`) was only the
_venue_ where the failure was observed; it isn't the cause and has
nothing to fix on its side. No upstream report is needed there.
