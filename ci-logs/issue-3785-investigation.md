# Issue 3785 CI investigation

The initial `43ea0960` release run required approval and had no jobs or downloadable
logs. The other initial dispatched checks passed; this was not evidence of a
code assertion failure. Initial run metadata and the unavailable-log response are
retained alongside this note.

The first implementation head was `56a57e046fb249b85ce47e5bf7df40af428378da`.
[Broken Link Checker run 40271384218](https://github.com/link-assistant/hive-mind/actions/runs/40271384218)
started at 2026-10-26 04:53:43 UTC, after that head was pushed. Its downloaded
`links-40271384218.log` has 636 lines. Line 351 reports HTTP 404 for the pinned
Codex refresh-manager citation; lines 369–371 identify
`experiments/issue-3785/upstream-report.md:29`. The same bad link was present in
the case study. This is an introduced documentation error.

Both citations were corrected from `login/src/auth.rs` to
`login/src/auth/manager.rs`. The pinned GitHub API source has SHA-256
`e650a5d08b98a919bbdfe0035d527b0b8480554b2de406961ed6355f47cf1c60`, matching
the source used for the investigation. The corrected browser URL returns HTTP
200. The already-posted upstream report was edited to fix its citation as well.
Raw CI logs stay local because link-checker redirect output can contain expiring
signed asset URLs. This note preserves the error, location, head and resolution.

The same head's [release run 40271384276](https://github.com/link-assistant/hive-mind/actions/runs/40271384276)
failed before tests. Its 4482-line `release-40271384276.log` lists 33 stale
declarations/lock entries at lines 3721–3754: Formal AI 0.355.7 versus 0.355.11,
start-command 0.39.2 versus 0.40.0, Secretlint 13.0.7 versus 13.1.0, and
magic-string 1.4.3 versus 1.4.4. These pins were inherited from the base branch.
The image/runtime pins, matching tests and npm lockfile were refreshed. The
local enforcing freshness check then reported 178/179 declarations current,
zero lockfile lag, and the existing open Router compatibility exception.

The start-command 0.40.0 release reads older execution stores, but older
versions cannot read stores written in its new format. This upgrade should not
be rolled back by reusing a newly written store with an older CLI. Its upstream
release also includes dependency/sanitizer fixes. Formal AI 0.355.11 is a patch
release with tool-metadata caching and cleanup verification fixes. Registry and
release metadata were checked before updating.

Superseded heads were cancelled by the existing per-branch concurrency policy.
Security run 40271384228 stopped in checkout (`security-40271384228.log:354`,
390 lines total), before analysis. The cancellation logs for 78d581fed's
security/release runs 40271576619 and 40271576799 are unavailable: `gh run view
--log` returned `log not found` for jobs 121405332105 and 121405471144. These
cancellations do not establish a code failure or a passing check. On e5ccc5eec,
Security, Workflows and Broken Link Checker completed successfully; release
lint, file-line, documentation, changeset and syntax checks passed before the
release run was cancelled by a newer commit. Its partial downloaded log has
35915 lines; `gh` then reported unavailable job log 121410311814. It does not
provide results for the cancelled test/image jobs.

Although the Security workflow jobs succeeded, CodeQL posted two findings in
[review 5647622216](https://github.com/link-assistant/hive-mind/pull/3786#pullrequestreview-5647622216).
Finding 309 traced the subscription success log to the credential plan label;
its reproducing test fails when synthetic credential/provider sentinels are
logged. The log is now constant and the test passes. Finding 310 identified a
substring URL assertion in the Router regression test; the assertion now
compares the complete, unique generated `base_url` line. Neither finding was
dismissed or suppressed. Fresh PR-merge CodeQL analysis for head `faf96022a` (merge commit
`2955366406d27dffb6124f6e4a6d6c42f8916a86`) marks the most recent instances of
findings 309 and 310 as `fixed`; neither was dismissed or suppressed.


On `faf96022a`, [Checks and release 40274978015](https://github.com/link-assistant/hive-mind/actions/runs/40274978015)
started at 05:34:47 UTC after the 05:34:41 UTC commit. The `test-suites` job
121419694963 failed at 05:54:45 UTC. Its downloaded
`test-suites-40274978015.log` lines 5249–5263 identify
`tests/solve-queue.test.mjs:1230`: mocked high Codex usage did not trigger
one-at-a-time mode. The test seeded the old unversioned `codex` cache key,
which the new path/generation-aware cache correctly ignores. Its synchronous
test helper also did not await async callbacks, allowing later tests to clear
state and the process to exit before assertions. The repaired test seeds through
the public cache API, awaits async tests sequentially, and isolates test homes
from operator credentials. The isolated reproducer failed on the original
cache setup (70 passed, one failed); the repair passes all 71 assertions.
All 698 files in the full default suite passed after these changes.

That release run completed at 06:10:57 UTC. Its Docker PR checks passed, as did
lint, compilation, docs, Helm, memory and execution checks. The pipeline status
failed because of the queue assertion; this does not certify the new canonical
storage and global-baseline contracts, which those image checks do not test.
The complete run log was downloaded after completion as
`release-40274978015.log` (53648 lines); the failing job log above provides the
precise assertion location without unrelated build output.

For pushed head `72ef43025db921defecce2cba1b3d9a29479b5f1`, the follow-up
[Checks and release run 40281077640](https://github.com/link-assistant/hive-mind/actions/runs/40281077640)
completed successfully at 07:04:20 UTC. Its test-suites job passed at
06:52:52 UTC and Docker PR checks passed at 07:03:43 UTC. Security run
40281077605, Broken Link Checker run 40281077652 and the explicitly dispatched
Workflows run 40281141757 also succeeded on this head. This resolves the observed
queue assertion failure; the pending semantic/global-baseline changes require
their own newest-head validation after push.

The subsequent local 699-file run found intermittent queue interference in
`/tmp/issue-3785-global-baseline-default.log`, lines 5044–5045 (file 232).
Unlike the earlier CI failure, the corrected cache seed was already present.
Automatic consumers could outlive `stop()` and cross later tests' cache resets;
in-flight usage requests were held in a module-wide map independent of the
cache instance. A deterministic regression reproduced joining obsolete work
(14 tests passed, one failed in `cache-reset-before.log`). A WeakMap now scopes
pending requests by cache instance. The 22 focused cache/limits tests and all
71 queue assertions pass; queue unit tests explicitly disable automatic
consumers. The new full-suite and CI results must be checked before claiming
validation for these changes.

On head `d4cfbebb8a3d73aefe7b2ea3b0dc9a434db569d2`, [Checks and release 40292041959](https://github.com/link-assistant/hive-mind/actions/runs/40292041959) failed at the changeset gate. The downloaded `release-40292041959.log` lines 7980–7994 show four added changesets where exactly one is required. The three later atomic changeset descriptions are now consolidated into the original patch changeset. Test and image jobs were skipped by this gate and are not counted as passing. Security and links succeeded on that head.

On pushed head `b8f30695e66131046e854d72d03f1bef3abb5270`,
[Checks and release 40292596806](https://github.com/link-assistant/hive-mind/actions/runs/40292596806)
started at 08:29:20 UTC and succeeded. The changeset gate, all test suites and
both actual image builds passed. The downloaded `docker-40292596806.log`
(3224 lines) records selection of the branch package at line 417; build-time
stock gates passed at lines 2234 and 2614, and the installed gate passed again
after boot at lines 2849 and 3066. Both container verification suites passed
at lines 2862 and 3079. Security 40292597220, Links 40292596801 and manually
dispatched Workflows 40292842799 also succeeded on this exact head. The later
MCP changes need their own newest-head checks. These stock and existing DinD
restart checks do not test the unfinished canonical auth/history contract or
the required restored-state and capability-isolation lifecycle matrix.

On pushed head `06ae4833ec6e63d65b597e9f1aab0a8a7b9beb11`,
[Checks and release 40297721311](https://github.com/link-assistant/hive-mind/actions/runs/40297721311)
started at 09:12:04 UTC and succeeded, including all test suites and both actual
image builds. The downloaded `docker-40297721311.log` has 3221 lines. Line 421
records branch-package selection; post-boot installed stock verification passes
at lines 2846 and 3063, with complete container verification passing at lines
2859 and 3076. Security 40297721178, Links 40297721957 and manually dispatched
Workflows 40297734362 also succeeded on that exact SHA. The later strict native
catalog and mount-backing changes still require their own newest-head CI.

On head `b0ae348d10bc44cff4c90375111b7077a619577f`,
[Checks and release 40304694014](https://github.com/link-assistant/hive-mind/actions/runs/40304694014)
started at 10:05:46 UTC. The completed detector job 121510796719 compared the
previous passing head `06ae4833e` with this head (downloaded
`detect-40304694014.log:3730`). Its changed-file list includes the new image
gate and installed runtime at lines 3751–3757, but line 3766 reports
`docker=false`; Docker job 121512007180 was skipped. This does not validate
the newly required packaged mount check. The real-detector regression reproduces
the source-only skip, then passes after adding packaged source/dependencies,
startup and image verification inputs to Docker selection. Both existing
change-range regression scripts also pass (44 legacy cases plus the untested-
head scenarios). Newest-head actual image validation is still required.

On `16abaede39ca1952a392f0a23014fee5c93a8f38`,
[Checks and release 40306469137](https://github.com/link-assistant/hive-mind/actions/runs/40306469137)
started at 10:19:12 UTC. Docker job 121518296928 now runs instead of skipping.
The test-suites job 121518297483 failed at 10:23:46 UTC; downloaded
`test-suites-40306469137.log:979–1004` identifies
`tests/dind-stale-pid-cleanup-3214.test.mjs:203`. Its assertion still required
changes to `scripts/detect-code-changes.mjs` to skip Docker selection. That
expectation contradicts the newly required image-gate selection contract. The
test now requires detector changes to select Docker while an unrelated script
still does not. All 11 DinD cleanup cases and the real-detector selection
regression pass locally. The image job's eventual result is separate from this
test-suite failure; it must be reviewed before recording image validation.
