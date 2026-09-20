# F25 — A PR can go green with its code never tested, by pushing a docs-only commit last

**Severity:** High · **Class:** False negative (a green merge gate over unverified code)
**Status:** **Diagnosed, deliberately not fixed in this PR** — reversing it would undo a
tested decision from issue #1665. See "Why not fixed here".
**Demonstrated live on this very PR**, not reconstructed.

## The mechanism

On `pull_request: synchronize`, `scripts/detect-code-changes.mjs` diffs the **previous PR
head against the new one** — the incremental push — rather than the PR base against head:

```js
function getPullRequestSynchronizeChangedFiles() {
  const beforeSha = process.env.GITHUB_BEFORE_SHA;
  const afterSha = process.env.GITHUB_AFTER_SHA || process.env.GITHUB_HEAD_SHA;
  if (ensureShaAvailable(beforeSha, 'Before') && ensureShaAvailable(afterSha, 'After')) {
    return diffChangedFiles(beforeSha, afterSha, 'PR head update');
  }
```

Every heavy job — `test-suites`, `test-compilation`, `memory-check-linux`, `docker-pr-check`
— is gated on the resulting `mjs-changed` / `any-code-changed` outputs.

The unsound step is the join between that and how a PR is merged: **branch protection reads
the _latest_ run.** The incremental diff is only a valid basis for skipping if the previous
head's checks actually passed. Nothing checks that.

So the last push decides what is tested, and every earlier push decides what is merged.

## What happened here, exactly

| Commit     | Contents                        | `detect-changes` | `test-suites`                             |
| ---------- | ------------------------------- | ---------------- | ----------------------------------------- |
| `fd3a44ef` | 59 `.mjs` files                 | `mjs=true`       | **ran — failed** (exit 13)                |
| `1e04c45e` | the `.mjs` fix for that failure | `mjs=true`       | **skipped** — changeset gate failed first |
| `15888c1e` | `.changeset/*.md` only          | `mjs=false`      | **skipped** — no code detected            |

Run 29693330753 for `15888c1e`, verbatim:

```
Comparing PR head update: 1e04c45e..15888c1e
Changed files:
  .changeset/olive-otters-shave.md
  .changeset/olive-pans-shout.md

mjs=false
...
code=false
```

Jobs that actually ran: `detect-changes`, `lint`, `validate-docs`. **Conclusion: success.**

The PR was therefore reported green while the fix for a known, reproduced CI failure sat on
the branch **never once having been executed by CI**. The only reason the defect is not
still hidden is that it was verified locally under Node 24 by hand.

Note the compounding shape: it took a _failing_ run (`1e04c45e`) followed by a _trivial_
one to produce it. A gate failing early is precisely when the later push is most likely to
be small — a changeset fix, a lint fix, a doc tweak. The mechanism is most dangerous exactly
when it is most likely to fire.

## Why this is not the same as issue #1665

Issue #1665 fixed a real bug: a multi-commit push whose diff range was computed too
narrowly, so code in the push was missed. The fix widened the range to the full push, and
`tests/test-detect-code-changes-1528.mjs:316` pins the intended behaviour:

```js
assertIncludes(output, 'mjs=false');
assertIncludes(output, 'code=false');
```

That test is correct about the push. F25 is not a claim that the diff is computed wrongly —
it is computed exactly as designed. The gap is that "what this push changed" is being used
to answer "has this PR's code been verified", and those are different questions whenever a
previous run did not succeed.

## Recommended fix

Not "always diff base..head" — that discards the CI-time saving #1665's design was after,
on every docs-only push in the repository.

The targeted invariant: **skip only what a previous green run already covered.**

1. Preferred — condition the incremental diff on the previous head's conclusion. If the run
   for `GITHUB_BEFORE_SHA` did not succeed, fall back to the full `base..head` diff. This
   keeps the optimisation for the common case (green PR, small follow-up push) and removes
   it in exactly the case that produces a false green.
2. Simpler, coarser — make the skipped jobs report `neutral`/failure rather than `success`
   when they are skipped without a known-good predecessor, so branch protection cannot be
   satisfied by a run that tested nothing.
3. Cheapest mitigation, no logic change — require a `pull_request` full-diff evaluation on
   `ready_for_review` and before merge, so the final gate always sees the whole PR.

## Why not fixed here

Option 1 needs the Actions API inside `detect-code-changes.mjs` (a new permission and a new
network dependency in a script currently pure and offline-testable), and options 2–3 change
merge-gate semantics repo-wide. Any of the three overturns behaviour that issue #1665
deliberately introduced and pinned with a passing test. That is a decision the maintainers
should make explicitly rather than have folded into a CI-cleanup PR — the same standard
applied to the sibling environment variables in F22.

Recorded here with the run IDs and verbatim output so the decision can be made on evidence.

## Workaround used for this PR

The PR was closed and reopened, so the event became `reopened` rather than `synchronize`,
which routes through `getPullRequestFullChangedFiles()` and evaluates the whole PR diff —
forcing `test-suites` to actually run against the branch's `.mjs` changes.

That workaround is itself the argument for the finding: getting a PR's own code tested
before merge should not require knowing this.
