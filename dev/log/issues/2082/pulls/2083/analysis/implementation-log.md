# Implementation log — issue #2082 / PR #2083

What has actually been changed, why, and how each change was proven. Findings are
numbered as in [`../README.md`](../README.md).

Every entry follows the same discipline, required by the task brief: **a test that
reproduces the defect is written and seen to fail before the fix**, then the fix is
made, then the defect is **re-introduced to confirm the new test catches it**
(mutation check). A fix whose test cannot be made to fail is not evidence of
anything.

| Finding   | Class                    | Commit     | Reproduced | Mutation-checked |
| --------- | ------------------------ | ---------- | ---------- | ---------------- |
| F1        | False negative           | `ba3c57a4` | yes        | yes              |
| F5        | False positive + fragile | `02498ca3` | yes        | yes              |
| F4        | False negative           | `ec858696` | yes        | yes (×2)         |
| F6        | False negative           | `0e4eb599` | n/a¹       | n/a¹             |
| F3        | False positive           | `5b9155c7` | yes        | yes              |
| F13 + F14 | False negative           | `9a1cbf48` | yes        | yes              |

¹ F6 is a missing-configuration finding, not a behavioural defect: there is no
failing execution to reproduce. The enforcement test is guarded against passing
vacuously instead (see below).

---

## The single mechanism behind F1, F4 and F5

All three are the same root cause wearing different clothes, and it is worth
stating once.

`command-stream`'s `` $`...` `` **does not throw on a non-zero exit code** — it
resolves with a `.code` property. Scripts that were converted from bash to `.mjs`
kept the shape of the original (`set -euo pipefail`; run a command; assume that a
failure aborts) but lost the semantics. The wrapping `try/catch` in each script is
decorative: nothing ever throws into it.

Confirmed experimentally, not inferred — see
[`issue-2082-command-stream-throw.mjs`](issue-2082-command-stream-throw.mjs) and
its recorded output.

The fix is `scripts/run-command.lib.mjs`: `runStrict()` wraps `node:child_process`
and restores `set -e`. It deliberately uses only Node built-ins, so it keeps
working whatever state `node_modules` is in — the failure it guards against
includes "the install step is what broke".

---

## F5 — npm double-publish race (`02498ca3`)

**Symptom.** A _green_ release run publishing the same version twice.

**Evidence.** Run 29647956700, reconstructed from its own logs:

| Time     | Event                                                                   |
| -------- | ----------------------------------------------------------------------- |
| 14:38:46 | `npm publish` succeeds; v2.8.3 tagged                                   |
| 14:38:46 | `npm view` returns **E404** ~0.3s later (registry CDN lag)              |
| 14:38:47 | attempt 2 re-runs the **entire** `changeset:publish`                    |
| 14:38:5x | npm: "You cannot publish over the previously published versions: 2.8.3" |
| 14:39:10 | attempt 3 verifies successfully → job green                             |

**Root cause.** Retry _granularity_, not the verification itself. The verification
is the #2028 false-positive protection and must stay. But a failed verification
fell through to the top of the retry loop, which re-ran publishing rather than
re-running the check. The run went green only by luck: a third attempt happened to
fit the budget, _and_ by then no changesets remained for attempt 3 to publish.

**Fix.** `waitForVersionOnRegistry()` polls with exponential backoff (2s → 30s,
~90s total) _without_ republishing. A successful publish that never becomes visible
now fails loudly instead of being retried into a conflict. `isVersionConflict()`
classifies `EPUBLISHCONFLICT` **before** the non-retryable auth classifier —
npm reports that conflict with a 403, which the auth classifier would otherwise
mistake for a credentials problem.

**Caveat recorded for the next iteration.** npm ≥ 11.5.1 surfaces a failed OIDC
trusted-publishing handshake as a _misleading 404_. That is not propagation lag and
no retry loop will fix it. If this recurs, check the publish job's npm version
first (npm/cli#3424, #9043, #593).

## F4 — lost version-bump push reported as success (`ec858696`)

**Root cause.** Same fail-soft `$` as F1, worse consequence. `git push origin main`
is racy by construction: the release workflow pushes the version bump to main while
merges and other runs push to the same branch. A rejected non-fast-forward push was
swallowed — the script printed "Version bump committed and pushed to main", set
`version_committed=true`, and exited 0, handing the downstream publish job a version
that existed only in the runner's local checkout.

**Fix.** Logic extracted to `scripts/version-and-commit.lib.mjs` (injectable
dependencies, so it is testable at all), every command through `runStrict`, and
`pushWithRebaseRetry()` rebases onto the new remote HEAD before retrying. A bare
retry would be rejected identically — the test pins that the rebase happens _between_
the two pushes, not merely that a retry occurs. `isNonFastForward()` distinguishes a
lost race from auth/network/protected-branch failures, which rebasing cannot fix and
which therefore fail immediately with the real error.

`version_committed=true` is now emitted only after a push that actually landed.

**Note.** This fixes the _symptom_. The _cause_ — two runs racing for main — is F14.

## F6 — no job timeouts (`0e4eb599`)

22 of 26 jobs had no `timeout-minutes`, inheriting GitHub's 360-minute default: a
hung job burns six hours of runner time and then reports as a generic failure that
looks nothing like a hang.

Timeouts were chosen from **measured** durations across four successful runs
(test-suites 11m max, Docker DinD amd64 7m, Docker amd64 6m, everything else under
2m) with 2–3× headroom, not guessed.

**The trap.** A job that calls a reusable workflow via a job-level `uses:` does
**not** support `timeout-minutes`; the timeout must live in the called workflow. A
naive check would replace a false negative with a false positive. Conversely, a
_step_-level `uses:` is an action and does **not** exempt the job — getting that
backwards would silently exempt almost everything. Both directions are pinned in
`tests/ci-workflow-timeouts-2082.test.mjs`.

Nothing off the shelf enforces this: zizmorcore/zizmor#1023 and rhysd/actionlint#49
are both still open. Hence the local check.

Because there is no failing execution to reproduce, the test is instead guarded
against **passing vacuously**: it asserts that workflow files were actually found
and that more than one job was parsed, so a broken glob or a parser that silently
matches nothing fails rather than reports success. The scanner result was
cross-validated against a real `js-yaml` parse (26 jobs, none missing).

## F3 — shell assertions that cannot fail (`5b9155c7`)

**Symptom.** `scripts/test-auto-fork-option.sh` ran three assertions and reported
none of them. Each failed branch printed `Could not verify ...` and the script
carried on to `exit 0`.

**This was not a latent risk — it was actively failing.** Reproduced locally: the
marker the script greps for first appears **~32s** into the run, because `solve.mjs`
makes several GitHub API calls before reaching the auto-fork decision. The script
killed the command with `timeout 10s`. Both greps had been failing on _every_ run
while the job stayed green.

**Mutation check.** With the assertions fixed, restoring `timeout 10s`:

```
PASS: solve.mjs documents --auto-fork
PASS: hive.mjs documents --auto-fork
FAIL: solve.mjs acts on --auto-fork
FAIL: hive.mjs acts on --auto-fork
PASS: start-screen.mjs reports screen is unavailable rather than failing on the flag
--auto-fork option tests FAILED           (exit 1)
```

Those two FAILs are precisely what CI had been reporting as success.

**Fix.** Realistic timeouts; every check asserts and the script exits non-zero; and a
hermetic `--help` check that needs no network, so a genuine flag regression is still
reported precisely when the network-dependent checks are unavailable.

`check-file-line-limits.sh` had a related hole: a missing `release.yml` was a warning
that skipped the check entirely. It is now an error.

**Enforcement.** `scripts/shell-lint.lib.mjs` flags any `else` branch that reports a
failure without failing. Two exemptions, both deliberate:

- branches that **record** the failure for a later check (`FAILURES+=(...)`,
  `BROWSERS_MISSING="..."`) — the branch does not fail but the script still does;
  flagging these would be a false positive inside the false-positive checker;
- branches that are genuinely non-fatal, which must now say so with an explicit
  `# shell-lint: allow-nonfatal` marker and a reason. Three such branches exist
  (diagnostics inside an already-failing path, an informational bun listing, and a
  documented PR-build toleration). The marker converts a silent fall-through into a
  reviewed decision.

ShellCheck does not cover this: an `else` that only echoes is valid bash, so judging
it requires repo-specific intent. (SC2181 addresses the inverse problem — testing
`$?` instead of the command.)

## F13 + F14 — cancellation policy (`9a1cbf48`)

**F14.** The concurrency policy was inverted:

```yaml
cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

This cancelled in-progress runs on **main — the one branch that publishes** — and
queued them everywhere else. A release cancelled between `npm publish` and the
`git push` of the version bump leaves the registry ahead of the repository. That is
the same split-brain state as F4 and F5, reached by a third route. Superseded PR
runs are the ones worth cancelling; nothing is published from them.

The original comment argued that cancelling on main lets the newest commit release
without waiting. Under the new policy a newer release _queues_ — it is delayed, never
lost. Given that the failure mode being traded away is a half-completed publish, the
delay is the cheaper cost.

**F13.** Nine jobs guarded their `if:` with `always()`, which is true even after a
cancellation — so they would have defeated the policy above. `release.yml` already
documents this rule at the top of the file (from the #1274 and #1278 case studies)
but had applied it only to the Docker jobs. Five used bare `always()`; four paired it
with a contradictory `always() && !cancelled()`.

**Verification.** Rather than trusting the edit, both versions of the file were
parsed with `js-yaml` and every job's effective condition compared: exactly 9 of 25
jobs changed, each only in the leading term; the other 16 byte-identical.

**A trap worth recording.** `if: !cancelled() && ...` is **invalid YAML** — a leading
`!` is a tag, and the file fails to parse with `unknown tag !<!cancelled()>`. The
expression must be wrapped in `${{ }}`. The previous `always()` spelling did not need
this, so the naive substitution silently breaks the workflow. Caught here only
because the change was validated with a real parser.

---

## An incident of the same class, caused by this PR

Worth logging, because it demonstrates the very failure mode the issue is about.

The `timeout-minutes` additions in `0e4eb599` pushed `release.yml` from 1491 to 1512
lines — over the 1500-line limit enforced by `check-file-line-limits`. **No CI run
caught it.** The missing changeset failed the changeset gate, and because nearly
every other job is conditioned on `needs.changeset-check.result == 'success' ||
... == 'skipped'`, all of them were _skipped_. The run was red for one reason while
concealing another.

This is a structural false negative in its own right: a single early gate can mask
every downstream check, and a skipped job is not a passed job. Resolved here by
extracting two Docker blocks into `scripts/docker-pr-build.sh` and
`scripts/docker-pr-verify-containers.sh` (1452 lines) and adding the changeset — but
the masking behaviour itself is worth a follow-up finding.

---

## F21 / F22 — linting `tests/`, and what it uncovered

**F21.** `npm run lint` and `eslint.config.mjs` both scoped linting to `src/`, `scripts/`
and `eslint-rules/`. `tests/` — 340 files — was in neither, so the `lint` job had been
green while never reading the largest `.mjs` tree in the repository.

Enabling the glob surfaced defects in 59 files: `assert.match` regexes containing
unescaped literal indentation (an assertion that passes for the wrong reason is worse
than one that fails), a `catch` discarding the original error, and unused bindings.

**Verification.** The contract test was mutation-checked in both directions
independently — once with the tree removed from `package.json`, once with it removed from
`eslint.config.mjs` — because a contract test that cannot fail is the very thing F3 is
about. The second attempt initially mutated nothing: Prettier had reformatted the config
back to a single line, so the multi-line regex missed. Worth recording, since a
"passing" mutation check that silently applied no mutation would have proven nothing.

**F22.** Running the newly-linted suite produced 5 failures in
`test-opus-47-model-support.mjs` — which CI reports as passing.

The first hypothesis was a Node mismatch (sandbox 20, CI 24). Wrong: the behaviour is
deterministic on both. The actual cause is that `getClaudeEnv()` spreads `process.env`,
sanitises an inherited `MAX_THINKING_TOKENS` for adaptive-only models, and does nothing
equivalent for `CLAUDE_CODE_EFFORT_LEVEL`. On every path that computes no level — a model
supporting none at all (`haiku`), or `--think off` — the parent's value survives into the
child. Claude Code exports that variable and hive-mind's agents run under Claude Code, so
`haiku --think high` was inheriting `effort=max`.

The diagnosis was reached by elimination rather than assumption: each predicate feeding
`adaptiveThinkingOnly` was evaluated directly and all returned `false`, which proved the
value could not be coming from the assignment block — and `haiku` skips that block
entirely, yet still carried a level. That left inheritance as the only source.

**The transferable point.** The test had been returning opposite verdicts in the two
environments for the same commit. CI's green was a fact about the runner's environment,
not about the program; the local red was the informative one, and was the easier of the
two to dismiss as local noise.

Three sibling variables (`CLAUDE_CODE_DISABLE_1M_CONTEXT`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`,
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`) leak identically and are confirmed present in the agent
environment. They are deliberately **not** changed here — no sanitisation precedent, no
failing test, and plausibly intentional user configuration. Flagged for an explicit
decision instead of a silent one. See `F22-effort-level-env-leak.md`.
