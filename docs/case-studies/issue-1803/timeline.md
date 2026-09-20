# Timeline — Issue #1803

## 1. Bug introduced

PR #1333 (fix for #1332) added support for fork repo names that don't
match the base repo name (e.g. when the fork already had a prefix). It
threaded `forkRepoName` from `headRepository.name` through:

- `solve.mjs` → `setupRepositoryAndClone(...)` →
- `solve.repo-setup.lib.mjs` → `setupRepository(...)` →
- `solve.repository.lib.mjs`

In `solve.repository.lib.mjs`'s `setupRepository`, the
"continuing-an-existing-fork-PR" branch (`else if (forkOwner)`) computed:

```js
const headRepoName = forkRepoName || repo;
const standardForkName = `${forkOwner}/${headRepoName}`;
const prefixedForkName = `${forkOwner}/${owner}-${headRepoName}`;
const expectedForkName = argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
const alternateForkName = argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName;
```

When `forkRepoName === "labtgbot-telegram-claude-agent"` (already
containing the upstream owner prefix) and `prefixForkNameWithOwnerName`
defaulted to `true`, this produced
`konard/labtgbot-labtgbot-telegram-claude-agent`.

## 2. Manifestation (external)

External run:
https://github.com/labtgbot/telegram-claude-agent/pull/4#issuecomment-4463389730

```
🍴 Fork mode:        DETECTED from PR
   Fork owner:       konard
✅ Using fork:       konard/labtgbot-labtgbot-telegram-claude-agent

🔍 Verifying fork:   Checking accessibility...
❌ Error:            Fork not accessible
   Fork tried:       konard/labtgbot-labtgbot-telegram-claude-agent
   Suggestion:       The fork's repo name may differ from the base repo name
   Hint:             Try running with --fork flag to create your own fork instead
```

The fork that _did_ exist —
`konard/labtgbot-telegram-claude-agent` — was never tried because the
fallback path is gated on `!argv.prefixForkNameWithOwnerName`, which was
`false` here.

## 3. Issue filed

#1803 was filed on 2026-05-15 by konard with the failing log and a
request to:

- download the failure evidence into a per-issue case-study folder,
- analyze and write up the case (timeline, requirements, root causes,
  solution plans, prior-art search),
- add debug output if the existing logs are insufficient,
- file reproducible reports against any related repo,
- plan and execute everything in a single PR.

## 4. Investigation and fix (this PR #1804)

- Reproduced the bug as a pure-logic simulation
  (`experiments/issue-1803-repro-double-prefix.mjs`).
- Identified that the prefix flag should only apply to fork
  _creation_, not _lookup_.
- Patched `solve.repository.lib.mjs` to trust `forkRepoName` directly:

```js
const expectedForkName = forkRepoName ? `${forkOwner}/${forkRepoName}` : argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
const alternateForkName = forkRepoName ? null : argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName;
```

And gated the fallback on `alternateForkName` being non-null so the
authoritative path never falls through.

- Added 9 regression tests
  (`tests/test-issue-1803-auto-fork-double-prefix.mjs`) covering both
  the source shape and the underlying logic.
- Re-verified that the existing #1332 test suite (14 tests) still
  passes — the `forkRepoName` plumbing it asserts is preserved.
