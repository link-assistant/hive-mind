# Case study: JavaScript first, Rust gated, one push per batch (issue #3043)

- Issue: [#3043](https://github.com/link-assistant/hive-mind/issues/3043)
- Pull request: [#3045](https://github.com/link-assistant/hive-mind/pull/3045)
- Upstream evidence: [link-assistant/router#759](https://github.com/link-assistant/router/issues/759)
- Integrated draft: [#3044](https://github.com/link-assistant/hive-mind/pull/3044) (guide text and the solve scheduler proposal)

## Problem

At [`4b32bc12`](https://github.com/link-assistant/hive-mind/blob/4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6/docs/CI-CD-BEST-PRACTICES.md), `docs/CI-CD-BEST-PRACTICES.md` described template selection, serialized release writers, cancellation and false-green prevention. It did not cover the router#759 contract for mixed Rust/JavaScript projects:

- native JavaScript behavior parity before any Rust job;
- a strict gate that rejects missing, partial and carried features;
- deterministic regeneration from pinned sources;
- a single coordinator that pushes once per validated batch.

The guide change is [principle 18](../../CI-CD-BEST-PRACTICES.md#18-javascript-first-rust-gated-one-push-per-batch), in all four languages. This document maps the issue's requirements to it, records what was taken from draft PR #3044, and keeps #3044's proposal for enforcing the single-push rule in `solve`, checked against the current code.

## Requirements and where they are delivered

| Requirement (issue #3043)                                                                              | Delivered in principle 18                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native JavaScript-first contract of router#759                                                         | Lead paragraph, with the router#759 evidence (3 of 18 and 0 of 44 green runs, OOM-killed `rustc`, 17–30 GiB `target/`)                                                                             |
| Carried source/WASM is not behavior parity                                                             | "A wrapper is not an implementation"; a source round trip shows preserved text, execution parity needs both native runtimes                                                                        |
| Strict missing-feature rejection                                                                       | The inventory's strict check fails on every entry marked missing, partial or carried                                                                                                               |
| Deterministic pinned regeneration                                                                      | Pinned translator and source, typed meta IR (for example Links Notation) kept, regenerate into a temporary directory and fail on drift before a Rust build                                         |
| Migration incomplete until a complete native JS implementation and a green strict readiness gate exist | "A migration is incomplete until both exist"; unfinished ports keep the gate red and are labelled blocked                                                                                          |
| Reusable prerequisite needs real caller checks                                                         | No default generator or placeholder command; template proposals rust#197 and js#231                                                                                                                |
| Dependencies from every Rust build/test/publish/container path                                         | Every Rust job `needs:` the gate and checks out `tested-sha`; failure, skip, drift and missing features each stop every Rust path; path filters cannot bypass it                                   |
| Single coordinator-owned push per validated batch                                                      | "One coordinator owns `git push`": workers draft, one coordinator verifies the exact candidate and pushes once, then waits for CI                                                                  |
| Review against GitHub `needs` / `workflow_run` semantics                                               | Example uses `!cancelled() && needs.javascript-first.result == 'success'`; `workflow_run` default-branch `GITHUB_SHA`, any-conclusion trigger, three-level limit and secret access are spelled out |
| Retain active writer `cancel-in-progress: false`                                                       | "Keep the existing writer rules" points to principle 10, which is unchanged                                                                                                                        |
| Update localized counterparts                                                                          | `CI-CD-BEST-PRACTICES.{zh,hi,ru}.md`, enforced by `tests/test-docs-language-sync.mjs`                                                                                                              |

`tests/cicd-best-practices-javascript-first-3043.test.mjs` asserts each row in English and the language-neutral anchors (workflow example, GitHub expressions, links) in every language.

## What was integrated from PR #3044

PR #3044 applied the router's raw `hive-mind.patch` to the English guide only and added `docs/SOLVE-CI-PUSH-SCHEDULER-PROPOSAL.md`. Every item is now in this pull request:

| PR #3044 content                                                                                                                        | Where it is now                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| JavaScript first; a browser UI, WASM wrapper, source envelope, filename set or test count is not parity                                 | Principle 18, "A wrapper is not an implementation"                                                  |
| Feature inventory (public APIs, CLI commands, errors, streams, persistence, deployment); missing/partial/carried rejected               | Principle 18, "Keep a feature inventory and reject anything not done"                               |
| Shared input/output fixtures, refusal and boundary cases, independent native execution                                                  | Principle 18, "Share fixtures between the runtimes"                                                 |
| Immutable pins, typed meta IR (Links Notation), source hashes, targets, refusal reasons, regenerate and compare                         | Principle 18, "Regenerate deterministically from pinned sources"                                    |
| Handwritten native adapters are explicit inventory entries with tests                                                                   | Principle 18, inventory bullet                                                                      |
| Template gate with real commands, no default generator, `needs:` before every Rust job, `tested-sha`, skipped is not success            | Principle 18, "Use a reusable gate with real commands" and "Every Rust path depends on it"          |
| Unfinished ports keep the gate red and report blockers                                                                                  | Principle 18, "A migration is incomplete until both exist"                                          |
| Avoid `workflow_run`; check conclusion, trust, `head_sha`, artifact provenance; read-only untrusted PR code                             | Principle 18, "Prefer `needs:` over `workflow_run`"                                                 |
| Parallel read-only checks; shared writer group with `cancel-in-progress: false`; reconcile remote state                                 | Principle 18, "Keep the existing writer rules"                                                      |
| Bulk drafting, one push owner, verify the exact candidate, wait for CI, combine all failures; push ≠ merge/publish/deploy/cache cleanup | Principle 18, "One coordinator owns `git push`"                                                     |
| Bound local work (no duplicate configurations, shared caches, compiler limits, measure, stop at budget, no weakened assertions)         | Principle 18, "Bound local work"                                                                    |
| References (router#759, GitHub `needs`, `workflow_run`, Cargo build cache)                                                              | Principle 18, closing references                                                                    |
| `docs/SOLVE-CI-PUSH-SCHEDULER-PROPOSAL.md`                                                                                              | [Proposed solve scheduler](#proposed-solve-scheduler-one-push-owner-and-complete-ci-feedback) below |

Three things differ from #3044:

- The guide text is a numbered principle with an example and bullets, not an unnumbered heading above the runner-pinning note.
- "this template's Rust-only sample" became "a Rust-only project", because the sentence only makes sense inside the template repositories.
- The scheduler proposal lives here rather than as a new top-level `docs/*.md` file. Every top-level `docs/*.md` must have `zh`, `hi` and `ru` siblings (`tests/test-docs-language-sync.mjs`), and #3044 skipped CI, so it never ran that check. Case studies are English-only. Principle 18 links here in all four languages.

## Proposed solve scheduler: one push owner and complete CI feedback

**Status: design proposal.** Nothing below is implemented. No supported CLI flag exists. Principle 18 states the single-push rule as a rule "until a tool enforces this"; this section specifies that enforcement for `solve`. It is taken from #3044, with each code claim checked against `main` at [`d6e47d1a`](https://github.com/link-assistant/hive-mind/tree/d6e47d1aa97de387d14b562d3642f8110dff1bfe) and corrected where the code differs.

### Existing extension points and their limits

| Existing function or option                                                                                                                                                                                                                                                                                                           | Verified behavior                                                                                                                                                                                                                                                                                       | Additional scheduler contract                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`PRE_PUSH_GUARD_SCRIPT`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/git-push-guard.lib.mjs#L79) / [`installGitPushGuard`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/git-push-guard.lib.mjs#L157)                              | Refuses ref deletion, history rewrites and overwriting a remote commit the clone lacks. Ordinary fast-forward pushes pass. Bypassed by `--no-verify`; the router's git transport is the unbypassable layer.                                                                                             | Keep these defenses and also deny every publication from drafting workers. Even an ordinary forward push needs the coordinator capability.                                                                         |
| [`checkPRCIStatus`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/github-merge.lib.mjs#L345)                                                                                                                                                                                          | Reads the PR's current head SHA, paginates check runs, adds commit statuses, and treats an empty list as pending. [`allPassed`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/github-merge.lib.mjs#L396) accepts `skipped` and `neutral`.               | Reuse the revision selection, but require an explicit `success` from the native JS, parity and translation checks: `skipped` or `neutral` cannot certify that gate. Keep run and attempt identity in the feedback. |
| [`getActiveBranchRuns`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/github-merge.lib.mjs#L673) and [`waitForBranchCI`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/github-merge-ci-wait.lib.mjs#L120)                             | Paginate the branch's runs in each active status (`in_progress`, `queued`, `waiting`, `requested`, `pending`). The wait loop logs API errors and retries; at timeout a failed final check returns `success: false` instead of "ready". It never cancels a run.                                          | Wait the same way before every correction push, keyed by an immutable batch identity. Waiting before a merge does not make worker publication exclusive.                                                           |
| [`detectAndCountFeedback`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/solve.feedback.lib.mjs#L14), [failed-check step](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/solve.feedback.lib.mjs#L366)                                  | Counts check runs on the PR head with `conclusion === 'failure'` completed after the last commit, and adds a single "Failed pull request checks: N" line. It does not count `timed_out` or `cancelled` and does not collect logs, annotations or artifacts.                                             | Persist every completed run attempt, job, step, log, annotation and artifact inventory for the last pushed SHA before forming one complete correction batch.                                                       |
| [`waitForCompareApiReady`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/solve.auto-pr-push-sync.lib.mjs#L22) / [`verifyBranchOnGitHub`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/solve.auto-pr-push-sync.lib.mjs#L122)          | Poll until the compare API sees the pushed commits. If the branch is not visible, it [retries once](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/solve.auto-pr-push-sync.lib.mjs#L158) with `git push origin HEAD:refs/heads/<branch>` (never forced). | Publish once under a durable batch lock, then poll visibility. A repeated push must never replace waiting for the CI that is already running.                                                                      |
| [`--auto-restart-max-iterations`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/solve.config.lib.mjs#L259), [`--auto-restart-until-mergeable-timeout-hours`](https://github.com/link-assistant/hive-mind/blob/d6e47d1aa97de387d14b562d3642f8110dff1bfe/src/solve.config.lib.mjs#L267) | Existing iteration and time budgets for restart loops.                                                                                                                                                                                                                                                  | Add explicit scheduler and collection budgets, and report a blocked or incomplete collection, never green, when a budget truncates it.                                                                             |

These are the concrete extension points found. This does not claim that no other Hive Mind tool has related functionality. Prompt rules and documentation help, but they do not enforce worker capabilities or exact-candidate stamps.

### Proposed configuration (not executable)

```json
{
  "scheduler": {
    "mode": "single-push-owner",
    "owner": "coordinator",
    "publicationIntent": "production",
    "workerPublication": "deny",
    "waitForActiveCI": true,
    "cancelExistingCI": false,
    "collection": {
      "scope": "all-completed-runs-and-attempts-at-last-pushed-sha",
      "allJobs": true,
      "logs": "complete",
      "annotations": true,
      "artifacts": "inventory-and-required-failure-evidence",
      "maxBytes": 524288000,
      "compression": "lossless"
    },
    "localGate": { "command": "repository-defined-native-js-gate", "requireCleanTree": true },
    "maxCorrectionBatches": 5,
    "maxWaitSeconds": 86400
  }
}
```

A future `solve --ci-push-owner coordinator --ci-feedback-policy complete-batch` could select this configuration once it is implemented. These flags do not exist today, and no help entry may suggest they do. Artifact collection lists exclusions, sizes and unavailable or expired downloads explicitly. A complete inventory is required; unbounded bulk downloads are not. Credentials, session transcripts and raw logs stay in the evidence store under the existing redaction policy, not in public issue text.

### State machine

1. **Batch record and lease.** Persist a batch keyed by repository, publication ref, expected remote head SHA and scheduler session. Elect one push owner with a cross-process lease. Workers may edit, test and commit locally and return draft patches. Their credentials and git transport policy cannot push, create releases or update the PR.
2. **Wait for CI on the last pushed SHA.** Enumerate every workflow run and attempt for that SHA, including queued, requested, waiting, pending and in-progress ones. Poll until every relevant run is terminal and the expected workflows have registered. Never cancel a run. API errors, timeouts or an ambiguous revision keep the batch blocked.
3. **Collect complete evidence.** Paginate each completed run's jobs and steps. Persist the complete available logs, check annotations, the artifact inventory and the required failure artifacts, with repository, run, attempt, job and head identities, content hashes and explicit gaps. Keep waiting for pending runs even after another job has failed. Expired or inaccessible required evidence makes the batch incomplete; a summary does not replace the raw evidence.
4. **One failure inventory.** Build it from every final job outcome: failed, timed out, cancelled and required-but-skipped. Assign independent fixes to drafting workers, merge their patches, and validate the combined change. Select the current attempt's conclusions explicitly, and do not blame one cause for every red run.
5. **Readiness stamp.** Run the repository's native JS, type, strict-parity and regenerate-and-diff gate on the assembled candidate before any Rust execution or production publication. Record a stamp with the candidate SHA, git tree hash, source and config hashes, toolchain identifiers and the successful check outcomes. Strict parity rejects missing, partial and carried behavior; generator verification also rejects stale or untracked generated files. An explicitly authorized review draft may expose incomplete behavior under a separate draft stamp that records its scope, exact candidate, completed checks and disclosed blockers. A draft stamp never authorizes Rust execution or production publication. Router#759 authorizes bulk review drafts before full runtime parity.
6. **Pre-push revalidation.** Immediately before pushing, reacquire the lock and verify that:
   - the local HEAD and tree, with no tracked or untracked changes, equal the stamp;
   - the remote head equals the expected SHA;
   - no relevant CI is active.

   A changed file, a moved remote head, a new active run or a lost lease invalidates the stamp; collect and validate again instead of pushing. Closing the check-to-push race needs durable ownership, compare-and-swap ref semantics and reconciliation after the push; the GitHub APIs are not atomic.

7. **One forward push.** The owner publishes one ordinary forward update and persists the new SHA. It polls visibility without pushing the same batch again, and starts the next batch only after collecting complete CI feedback for that SHA. Release and deploy writers keep cancellation disabled, and every Rust path requires the same exact successful JS gate revision.

### Acceptance tests required before advertising support

- Two workers that try an ordinary fast-forward push, a `--no-verify` push, a PR update or a release change are all denied; only the elected coordinator can publish. The existing destructive-push tests still pass.
- A failed job while another run is still queued or running causes neither a correction push nor a cancellation. Late check registration, more than 100 jobs and newly appearing runs never produce an empty success.
- Two workflows plus a rerun on one SHA yield every attempt, job, log hash, annotation and the complete artifact inventory. Several independent failed steps end up in one correction batch. A missing required log or artifact, a rate limit, an expiry, the disk cap or the wait budget yields blocked or incomplete evidence with a recoverable checkpoint.
- Each of these denies Rust execution and production publication: success only on an older SHA, a skipped or neutral JS gate, incomplete parity, stale generation and untracked generated output. The sole owner can still publish an authorized review draft with disclosed blockers, but its failing strict readiness keeps Rust blocked.
- A file, HEAD or remote-ref change after validation, a second coordinator, or a new active run invalidates the stamp. Only the reviewed, clean, stamped candidate is published, and only once.
- A crash between the push and the journal update reconciles with the actual remote SHA and resumes collection without pushing again. A timeout never cancels CI. Every public status distinguishes implemented guidance, proposed scheduler enforcement and incomplete project generation.

### Delivery boundary

This pull request delivers the guidance (principle 18, four languages, test) and this design. Implementation work remains:

- runtime modules;
- CLI parsing;
- credential capability isolation;
- durable storage and locking;
- GitHub evidence collection;
- exact-stamp enforcement;
- integration tests.

Approval of this documentation must not be presented as automated `solve` support. Issue #3043 owns this follow-up.
