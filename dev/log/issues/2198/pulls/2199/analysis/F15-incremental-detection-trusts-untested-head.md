# F15 — The change detector trusts a head that was never tested

**Severity:** High · **Class:** False negative (the pipeline reports green over code it never ran)
**Status:** Fixed in `fba98a4a`. Found on this PR's own runs, while checking that the fixes for F1–F14 were actually green.

## Symptom

Run [33886365226](https://github.com/link-assistant/hive-mind/actions/runs/33886365226)
("Checks and release", head `d871d1f9`) reports **success**. Its job list, captured in
[`../github/run-33886365226-jobs.json`](../github/run-33886365226-jobs.json), is mostly
the word *skipped*:

```
success  detect-changes
success  lint
success  validate-docs
skipped  test-compilation
skipped  check-file-line-limits
skipped  test-execution
skipped  test-suites
skipped  memory-check-linux
skipped  Release
...
success  Pipeline Status
```

`test-suites`, `test-compilation`, `check-file-line-limits` and `memory-check-linux`
never ran. The commit *before* it, `237acd2d`, is the one that extracted
`src/agent.version-gates.lib.mjs` — a change to `src/agent.lib.mjs`, the most-imported
module in the repository. Its own run,
[33886267473](https://github.com/link-assistant/hive-mind/actions/runs/33886267473), was
**cancelled**, and the API records **zero jobs** for it:

```console
$ gh api repos/link-assistant/hive-mind/actions/runs/33886267473/jobs --jq '.jobs[].name'
$                                     # empty: cancelled while still queued
```

So `src/agent.version-gates.lib.mjs` entered the PR under a green check mark, having been
compiled and tested by nothing at all.

## Root cause

Two correct-in-isolation mechanisms, each invalidating the other's premise.

**Issue #1665** made `scripts/detect-code-changes.mjs` compare `before..after` on a
`pull_request synchronize` event, so pushing a docs-only commit does not rerun the
expensive jobs. Sound — *provided the previous head was already tested*. That premise is
never stated anywhere in the script, and never checked.

**Issue #2082** set `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`
(`release.yml:1305` and its siblings), so a new push on a branch cancels the run in
flight. Also sound: a superseded run wastes runners.

Together they compose into a hole. Push A carries code and starts a run. Push B, one
minute later, carries only docs; it cancels A's run and its own run compares
`A..B`, sees Markdown, and skips the code jobs. **Nothing** tested A. The interval is
exactly the window in which a person fixes a typo in a document after pushing code — the
most ordinary sequence there is. On this branch it happened twice within eight minutes
(`f096b213`, `237acd2d`; see the run index above).

`Pipeline Status` cannot catch it: it is `if: always()` over `needs:` and treats
`skipped` as acceptable, because for a genuinely docs-only PR it must. It is answering
"did anything fail", not "was this code tested" — the F8/F12 shape again, **a control
that does not check the thing you assumed it checked**.

## Fix

Keep #1665's optimisation; check its premise. The incremental diff is used only when the
Actions API records a *successful* run of this workflow against `GITHUB_BEFORE_SHA`:

```
GET /repos/{repo}/actions/workflows/{file}/runs?head_sha={before}&status=success&per_page=1
```

`total_count > 0` means the previous head genuinely passed and the narrow comparison is
honest. Anything else — cancelled, failed, still running, never started — widens to the
full PR diff.

The workflow file is derived from `GITHUB_WORKFLOW_REF`
(`owner/repo/.github/workflows/release.yml@refs/pull/2199/merge`) rather than hardcoded,
so a rename cannot silently turn the check into a permanent "no runs found". The
`detect-changes` job gains `actions: read` over the workflow-wide `contents: read`, and
passes `GITHUB_TOKEN` and `GITHUB_WORKFLOW_REF`.

**Every failure mode falls back to the expensive answer.** No token, HTTP 403, an
unparseable body, no workflow context at all: each logs its reason and widens. A lookup
that cannot answer must not be read as a "yes" — that is how the defect got here.

## The invariant the proxy rests on

"A successful run exists for the previous head" is a *proxy* for "the previous head was
tested", and it is worth writing down why the proxy is sound — the original defect was
precisely an unstated premise, so leaving a new one unstated would repeat it.

The claim is inductive: **a successful run implies the code in its head has been tested,
by that run or by one it legitimately inherited from.**

- A docs-only push onto a tested head skips the code jobs and succeeds. Its head carries
  the same code as the previous head, which was tested. The claim holds.
- A push onto an *untested* head widens to the full PR and runs the code jobs. Success
  then means tested outright. The claim holds.
- A run that fails, is cancelled, or never starts records no success, so the next push
  widens. Conservative, and the claim is not relied on.

The base case is the only soft spot: runs recorded *before* this fix could be green while
having skipped everything — run 33886365226 above is one. Those are indistinguishable
from honest successes by this query, so for one push after this lands the proxy can say
"tested" about a head that was not. It is a transition artifact, not a standing defect,
and it self-heals on the first push whose previous head has a post-fix run.

Verified in production on the first run to carry the fix
([33890006722](https://github.com/link-assistant/hive-mind/actions/runs/33890006722)):

```
Successful runs of release.yml at 3daa84ca...: 0 (asked https://api.github.com/repos/link-assistant/hive-mind/actions/workflows/release.yml/runs?head_sha=3daa84ca...&status=success&per_page=1)
Previous PR head 3daa84ca... has no successful run of this workflow; comparing the full PR instead
code=true
```

The count is zero for the right reason: that head's own run had just been cancelled by
this push — the exact scenario the finding is about, caught live.

## Observability

The run before that one logged **nothing**. It fell back to the full PR diff, which is the
safe answer, but the branch taken when the workflow context is missing returned silently,
so "never asked the API" and "asked and was told no" produced identical output. A check
whose failures are indistinguishable from its successes is this issue's own subject
matter, reproduced inside the fix for it.

Every branch now names itself, and the successful path logs the count the decision rests
on together with the endpoint that produced it — the endpoint only, never the token. Two
assertions in the test cover it, because a diagnostic with no test regresses the moment
it is inconvenient.

`release.yml` also stopped setting `GITHUB_WORKFLOW_REF` from `${{ github.workflow_ref }}`.
The runner supplies that variable in every job as a documented default; overriding it with
an expression can only replace a guaranteed value with an empty one. The test asserts it
is left alone.

## The fix's own false negative, caught before it shipped

The first draft returned `null` for an unverified head, letting `getChangedFiles` fall
through to its full-PR branch. But that branch needs `GITHUB_BASE_SHA`, and without one
it falls through *again* — to `HEAD^..HEAD`, a **single commit**, narrower than the
`before..after` range it was replacing. A fix for a false negative that manufactures a
worse one.

`tests/test-detect-code-changes-1528.mjs` caught it immediately (*"multi-commit push …
Expected output to include `src/feature.mjs`"*), which is what an existing suite is for.
The rule now holds explicitly: **widening must never narrow.** With no base SHA to widen
to, the incremental range is kept, because *unverified* is not *known-untested*.

## Verification

`tests/detect-code-changes-untested-head-2198.test.mjs` builds a base → code → docs
fixture and drives the real script against a stub of the Actions API bound to
`GITHUB_API_URL` — the lookup is exercised end to end, offline, with no mocking of the
code under test.

| Case | Expected |
| --- | --- |
| Previous head has no successful run | `code=true`, full PR diff, reason logged |
| Previous head has a successful run | `code=false` — issue #1665 preserved exactly |
| Lookup answers 403 / non-JSON / no token | `code=true` in all three |
| No workflow context | Incremental behaviour, and no network call attempted |
| No base SHA to widen to | Incremental range kept, code commit still reported |
| `release.yml` | Still passes `GITHUB_TOKEN` and `GITHUB_WORKFLOW_REF` |

Both directions are mutation-checked: forcing `previousHeadWasTested` to `true`
reproduces the original defect and fails assertion 1; restoring the `return null` draft
fails the widening assertion. The stub server runs in the test process, so the child is
driven with async `execFile` — `execFileSync` deadlocks, the parent blocking the event
loop that has to answer the child's request.

## Scope

`cancel-in-progress` is on all four workflows, but only `release.yml` gates jobs on the
detector, so within this repository this is the only place the composition bites. Checked
with `grep -rn "detect-code-changes" .github/`.

### The template has it, and worse

The template gates the same way — `detect-changes` with
`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`, and `test-compilation`,
`lint`, `test` et al. hanging off `needs.detect-changes.outputs.any-code-changed`. But its
detector never had #1665 applied: it compares `HEAD^2^..HEAD^2`, **the final PR head
commit alone**, so it loses coverage with no cancellation involved at all. One push
carrying two commits — source, then documentation — is enough.

[`experiments/issue-2198/template-detect-changes-untested-commits.sh`](../../../../../../../experiments/issue-2198/template-detect-changes-untested-commits.sh)
builds the synthetic merge commit `actions/checkout` materialises and runs the template's
own `scripts/detect-code-changes.mjs` against it
([`../local/template-detect-changes-probe.txt`](../local/template-detect-changes-probe.txt)):

```console
=== PR contents: docs/notes.md src/feature.mjs
=== template detector, pull_request event
Comparing HEAD^2^ to HEAD^2 (per-commit diff of PR head)
  docs/notes.md
js-changed=false
any-code-changed=false
```

A pull request that adds `src/feature.mjs` is classified as containing no code. Every
check gated on `any-code-changed` skips, and the PR is green.

Reported upstream with the reproducer, both routes to the hole, and a fix in two stages —
adopt #1665's `before..after` range first, then this finding's premise check on top.
