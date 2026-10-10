# Proposed solve scheduler: one push owner and complete CI feedback

Status: design proposal for issue #3043 / draft PR #3044; no scheduler runtime implementation or supported CLI flag is supplied by this document. Existing PR #3044 adds contributor/CI guidance. This addition specifies executable enforcement still required by [Router #759](https://github.com/link-assistant/router/issues/759).

## Existing implementation and its limits

Evidence is pinned to Hive Mind `4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6`; the additive publication base is PR #3044 head `0f497abc289aad95f62fd2ac34724c972b703520`.

| Existing function or configuration | Verified behavior | Additional scheduler contract |
| --- | --- | --- |
| [installGitPushGuard / PRE_PUSH_GUARD_SCRIPT](https://github.com/link-assistant/hive-mind/blob/4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6/src/git-push-guard.lib.mjs#L79) | Existing destructive-push defenses reject deletion/history rewrite. The local hook allows ordinary forward updates and can be bypassed with no-verify; other transport layers are documented. | Retain these defenses and additionally deny every publication operation for draft workers. Ordinary forward pushes need the coordinator capability too. |
| [checkPRCIStatus](https://github.com/link-assistant/hive-mind/blob/4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6/src/github-merge.lib.mjs#L345) | Reads actual PR head, paginates check runs, combines statuses and treats empty registration as pending. Generic merge status accepts skipped/neutral checks. | Reuse revision selection but require explicit successful native JS/parity/translation checks; skipped/neutral cannot certify that gate. Keep run/attempt identity in feedback. |
| [getActiveBranchRuns](https://github.com/link-assistant/hive-mind/blob/4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6/src/github-merge.lib.mjs#L673) and [waitForBranchCI](https://github.com/link-assistant/hive-mind/blob/4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6/src/github-merge-ci-wait.lib.mjs#L120) | Paginate active branch runs; merge polling waits and fails closed when its final API check fails. | Invoke equivalent waiting before each correction push, with immutable batch identity and no cancellation. Merge waiting alone does not make worker publication exclusive. |
| [detectAndCountFeedback](https://github.com/link-assistant/hive-mind/blob/4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6/src/solve.feedback.lib.mjs#L359) | Counts failed checks on current PR head completed after last-commit time and triggers feedback. This branch collects a count rather than all job logs/artifact bytes. | Persist all completed run attempts, jobs/steps, logs, annotations and artifact inventory for the completed head before forming one full correction batch. |
| [waitForCompareApiReady / verifyBranchOnGitHub](https://github.com/link-assistant/hive-mind/blob/4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6/src/solve.auto-pr-push-sync.lib.mjs#L22) | Wait for post-push compare visibility and may retry an ordinary explicit ref push if branch visibility is absent. | Publish once under a durable batch lock, then poll visibility. Repeated pushes must not substitute for waiting on existing CI. |
| [solve configuration](https://github.com/link-assistant/hive-mind/blob/4b32bc12ceb8c0810bce57cc66160b4d60f8f4a6/src/solve.config.lib.mjs#L244) | Existing restart iteration/time budgets and development-log prompt options provide useful bounds and evidence instructions. | Add explicit scheduler/collection resource budgets and report blocked or incomplete collection, never green on truncation. Proposed options below are not existing options. |

The bounded inspection above establishes concrete extension points. It does not assert that every other Hive Mind tool lacks related functionality. Prompt requirements and documentation are useful but do not themselves enforce worker capabilities or atomic gate stamps.

## Proposed configuration, not currently executable

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

A prospective `solve --ci-push-owner coordinator --ci-feedback-policy complete-batch` can select this configuration only after implementation. Do not add a help entry that implies these flags already work. Artifact selection must explicitly list exclusions, sizes and unavailable/expired downloads; complete inventory is required, while unbounded bulk artifact downloads are not. Credentials, session transcripts and raw logs must remain in the evidence store under existing redaction policy, not embedded in public issue prose.

## State machine and enforcement plan

1. Create a persisted batch record keyed by repository, publication ref, expected remote head SHA and scheduler session. Elect one push owner with a cross-process lease. Workers can edit/test/commit locally and return draft patches; their process credentials and Git transport policy cannot push, create releases or publish PR updates.
2. Snapshot the last pushed SHA and enumerate all its workflow runs/attempts, including queued/requested/waiting/pending/in-progress states. Poll until all observed relevant runs are terminal and the configured expected workflows have registered. Never cancel an existing run. API errors, timeout or ambiguous revision keep the batch blocked.
3. Paginate every completed run's jobs/steps and persist complete available log bytes, check annotations, artifact inventory and required failure artifacts. Record repository/run/attempt/job/head identities, decoded hashes and explicit gaps. Wait for pending runs even if another job already failed. Expired or inaccessible required evidence blocks completeness; a summary is not a replacement for raw evidence.
4. Build one failure inventory from all final jobs, including failed, timed-out, cancelled and required skipped outcomes. Assign independent corrections to draft workers, aggregate patches, and validate the complete resulting change. Existing historic attempts remain available; select current attempt conclusions explicitly and avoid attributing one failure cause to every red run.
5. Require the repository's native JS/type/strict-parity/forward-and-reverse regeneration gate on the assembled candidate before Rust execution or production publication. Record a readiness stamp containing candidate SHA, Git tree hash, source/config hashes, toolchain identifiers and successful check outcomes. Strict parity rejects missing/partial/carried behavior; generator verification also rejects stale or untracked generated files. An explicitly authorized review draft may expose incomplete behavior with a separate draft stamp recording its authorized scope, exact candidate, completed checks and disclosed blockers; it cannot authorize Rust execution or production publication. Router #759 authorizes bulk review drafts before complete runtime parity.
6. Immediately before push, reacquire the publication lock, verify current local HEAD/tree and clean tracked/untracked status equal the applicable readiness or authorized draft stamp, remote head equals expected SHA, and no scoped existing CI is active. Any changed file, changed remote head, new active run or lost lease invalidates authorization; recollect/revalidate instead of pushing. Check-to-push races require durable ownership plus compare-and-swap ref semantics and post-operation reconciliation, not a promise that remote APIs are atomic.
7. The owner publishes one ordinary forward update and persists its exact new SHA. Reuse visibility polling without republishing the same batch. Start the next batch only after that SHA's complete relevant CI feedback has been collected. Keep release/deployment writer cancellation disabled; repository workflows require the same exact successful JS gate revision for every Rust path.

## Acceptance tests before implementing advertised support

- Two workers attempting an ordinary fast-forward push, a no-verify push, PR publication or release mutation are denied; only one elected coordinator can publish. Existing destructive-push protections still pass their tests.
- A failed job while another run is still queued/running cannot cause a correction push or cancellation. Delayed check registration, pagination beyond 100 jobs and newly appearing runs are handled without reporting empty success.
- Two workflows and a rerun on the same SHA yield all attempts/jobs/log hashes, annotations and complete artifact inventory. Multiple independent failed steps reach one consolidated correction batch. Required missing log/artifact, API rate limit, expiration, disk cap or wait budget yields blocked/incomplete evidence with a recoverable checkpoint.
- Success on an older SHA, skipped/neutral JS gate, incomplete parity, stale generation and untracked generated output all deny Rust execution and production publication. An authorized review draft with disclosed blockers can be published by the sole owner; its strict readiness failure must keep Rust blocked.
- File/HEAD/remote-ref changes after validation, a second coordinator or a new active run invalidate the gate stamp. Only the reviewed, clean stamped candidate can be published once.
- A crash between push and journal update reconciles the actual remote SHA and resumes collection without another push. Timeout never cancels CI. Every public status distinguishes implemented guidance, proposed scheduler enforcement and incomplete project generation.

## Delivery boundary

This PR extension is an additive design and test plan. Runtime modules, CLI parsing, credential capability isolation, durable storage/locking, GitHub collection, exact-stamp enforcement and integration tests remain implementation work. Documentation approval must not be presented as automated solve support. The existing issue #3043 owns this follow-up; no overlapping issue is necessary.
