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

On head `16abaede39ca1952a392f0a23014fee5c93a8f38`, required image run
40306469137 failed at 2026-10-26 10:43:26 UTC. The downloaded job log
`docker-40306469137.log` (3269 lines) records successful stock checks at lines
2268, 2645, 2880 and 3097. Lines 3219–3225 identify the newly required
installed-package mount check: `host daemon did not become ready`, at
`scripts/docker-pr-verify-mount-backing.mjs:56`. The nested mount check was not
reached. Existing DinD startup/restart/commit checks had passed.

The old readiness loop suppressed every exec error. Pinned Box 2.10.5's ordinary
image/essentials install sources do not install a Docker client, and neither
standard Hive nor Coolify added one. This is the supported cause inferred from
the image definitions; the old error cannot independently prove which exec
failed. Both host-socket image definitions now explicitly copy Docker's official
29.9.2 client and execute it during build. Running-image verification executes
the client too. Mount verification checks the client before daemon retries and
reports a distinct constant error, without publishing exec/daemon output.
Five regressions failed before this change and seven client/mount checks pass
after it. A finite, unprivileged, network-disabled probe confirmed a client-free
runtime rejects Docker execution, while the exact copied binary reaches the
host daemon through its socket group. This small probe is not the packaged
Box-image gate; the new head's actual image job must still pass.

The local 709-file run completed with three failures. At lines 5455–5472, the
watchdog inherited the operator CODEX_HOME despite giving its child a private
HOME; startup audit removed six cached plugin directories outside the fixture.
Native installed-plugin reconciliation restored all six directories, including
the original pages, plugin-management, sites and work-pets versions and 30 skill
files. The watchdog now strips inherited tool selectors/provider variables and
has a synthetic regression for that boundary. No model turn was started for
recovery. The initial watchdog reproducer and isolated rerun are local logs.

At lines 7617–7619 the older DinD variant test expected literal `Dockerfile.dind`
in the detector source; the equivalent new regular expression spells the dot
with an escape. The contract assertion now matches that spelling; actual
selection behavior remains covered by the throwaway-repository detector tests.
At lines 14483–14485 the real worker containment assertions did not trigger:
NODE_OPTIONS=--max-old-space-size=192 overrides worker resourceLimits, defeating
the test's intended 48 MiB limit. The same finite test passes all 40 assertions
without that process-wide override. Subsequent full-suite runs must not set a
heap option inherited by the worker. These local results do not count the
failed full run as passing.

On pushed head `e95fd3a6f4d0ac3292bd1b633b04f3019dd0dab5`,
[Checks and release 40312204221](https://github.com/link-assistant/hive-mind/actions/runs/40312204221)
started at 11:03:46 UTC and succeeded. Docker job 121537203044 completed at
11:26:57 UTC. Its downloaded `docker-40312204221.log` has 3330 lines; stock
verification passes during both builds (2330, 2717) and after boot (2953, 3171).
The newly required installed-package mount gate passes on the actual host
daemon at line 3292 and nested daemon at line 3293. Both concurrent synthetic
task writes reached the root fixture. This resolves the observed readiness
failure; native refresh and full-history lifecycle are not part of that gate.
Security 40312204150, Links 40312204159 and manually dispatched Workflows
40312203115 also succeeded on this exact head.

The subsequent local full run passed all 710 selected default test files with
the heap cap applied only to the runner command, not inherited NODE_OPTIONS.
That run began before the cloud-policy changes. The expanded 260-case focused
run independently covers those changes; five additional Coolify startup
regressions reproduce missing validation/hidden failures and pass after repair.
The newer commits require their own CI results.


Head `4c96f79544c327bd908c565472fce365c41be312` passed
[Checks and release 40315657485](https://github.com/link-assistant/hive-mind/actions/runs/40315657485),
created at 11:31:04 UTC and completed at 12:17:30 UTC on 2026-10-26. The
67k-line downloaded log is retained locally as `checks-40315657485.log`.
Targeted log reads show installed stock gates at lines 43289/43676 during
both builds and 43914/44132 after boot. Lines 44253–44254 show the required
host and nested daemon gates both passed. These checks cover the preceding
cloud-policy and Coolify-startup changes; the later XDG storage and release
condition commits require fresh CI. They do not verify the unfinished full
native lifecycle or migration contract. Security, Links and the dispatched
Workflows checks also passed on that exact head.

Head `7ce5ed3fa3798980edd48f158286a81915dd76da` passed
[Checks and release 40324630037](https://github.com/link-assistant/hive-mind/actions/runs/40324630037),
created at 12:42:44 UTC and completed at 13:25:22 UTC on 2026-10-26. The
downloaded local `checks-40324630037.log` preserves the full run. Targeted reads
at lines 70213–70218 show successful installed-package legacy mount and new
Agent/OpenCode directory-projection gates against both the host and nested
daemons. The actual branch-package images also pass their installed stock gates.
These tests exercise two synthetic filesystem writers, atomic replacement,
deletion/recreation, history markers and private config/cache identities. They
do not exercise native token refresh or the full history/migration matrix.
Security, Links and Workflows passed on the same SHA. Later head `93d512f`
requires its own CI; its Checks and release run is 40330696780.

Head `93d512fd2251d10c61a6b900661b9f2e2bc6beeb` run
[40330696780](https://github.com/link-assistant/hive-mind/actions/runs/40330696780),
created at 13:27:16 UTC, completed cancelled at 13:57:24 UTC after its default
test job failed. The full-run log endpoint cannot find a cancelled publishing
job's log; the failed test job was downloaded separately to local
`test-suites-40330696780.log` (3410 lines). Lines 3316–3340 identify
`tests/issue-3785-data-runtime-versions.test.mjs:10` and `spawn rg ENOENT`.
The first version-check unit fixture supplied only Agent/OpenCode commands and
accidentally required a runner-installed search executable after the verifier
added that check. Four other cases passed; package-image verification was
cancelled and does not count as passing.

Reproduced the same failure locally with PATH limited to `/usr/bin:/bin`.
The fixture now supplies its own synthetic `rg`, captures its disposable child
environment, and asserts all three version commands. All five cases pass under
that same restricted PATH. The negative missing/broken search cases and the
production image's actual `rg --version` requirement remain intact. This fixes
test isolation; the newer branch head still needs its own complete CI result.

The later local 719-file run stopped at file 166 on same-size credential
rewrites with unchanged timestamps; the retained full log is
`/tmp/issue-3785-profile-full-tests.log`. A finite rapid-rewrite regression
reproduces stale usage before repair; bounded internal content hashing fixes it
and all 26 cache/limits cases pass. The next 720-file run stopped at file 253
(`solve-queue.test.mjs`): its synthetic successful-usage seed had no available
credential file, which is no longer eligible for successful cache reuse.
Local log `/tmp/issue-3785-720-full-tests.log` lines 5496–5497 identify the
exact one-at-a-time assertion. Supply an empty disposable auth file and pin
Claude's independent credential selector to its fixture. All 71 queue assertions
pass afterward. Neither stopped full run counts as a pass.

Pushed `e69235db1cae58514f25bb58a74200f2812b0e97` has
[Checks and release 40339508388](https://github.com/link-assistant/hive-mind/actions/runs/40339508388),
created 2026-10-26 14:25:24 UTC. It remains queued while the later queue-fixture
correction is prepared; its result cannot certify that subsequent commit.

After the fixture correction, the complete local default suite passes all 720
test files on `0a3f4ddae4b64523fc45b3e9a52501ae8499943f`. The retained log
`/tmp/issue-3785-720-full-retry.log` ends with that exact result. The suite ran
sequentially using Node 26.12.1 and a 192 MiB heap cap on the runner only.
No cap or operator credential selector was injected into child test processes.

That head's [Checks and release 40342105431](https://github.com/link-assistant/hive-mind/actions/runs/40342105431),
created 2026-10-26 14:42:21 UTC, passes its default tests, lint, compilation,
memory, Helm and other completed jobs. Docker fails at 15:08:33 UTC and the
run completes as failure at 15:10:02 UTC. Security, Links and Workflows pass
on that same SHA. The full 71,313-line log is retained locally as
`checks-40342105431.log`. Lines 66382–66391 identify
`verify-mounted-tool-data.mjs:76`, the masked-cache search operation. Its task
image is `node:24-alpine`, which has no `rg`; the actual release images built
successfully, but their installed search executable was never supplied to the
small task fixture. A bounded real Docker reproduction exits 9 for the missing
command. The new controller regression fails with zero image executable copies.

The controller now copies `/home/box/.local/bin/rg` from each actual release root
into the disposable shared fixture and passes its source in the selected daemon
namespace. Both task containers mount that exact executable read-only; they
retain the production non-executable cache mask and the search assertion.
All three controller/task-cleanup unit cases pass. The real local Docker gate
passes for Agent and OpenCode with two participants and this read-only mount;
fresh packaged CI still needs to pass. The native source adapter
remains an experiment and is not covered by the earlier run.

The new source experiment's first workflow run
[40350456592](https://github.com/link-assistant/hive-mind/actions/runs/40350456592)
on `e507eef2466372ae2ff5bd84d60e726209375175` fails before any job starts.
GitHub reports a workflow-file issue and exposes no job log; the failed log
request is retained as `native-codex-40350456592.log`. Local actionlint 1.7.12
reproduces the prohibited `runner` context at job `env` (line 27), plus two
SC2024 diagnostics around background sudo redirection. Initialize the temporary
source path inside the fetch step and export it through `GITHUB_ENV`; group
the background prerequisite commands before redirecting their logs. The same
Docker actionlint/shellcheck check then passes. This is a workflow repair, not
evidence that the native acceptance probes passed.

A bounded local native `cargo +1.99.1 check --locked -j 1 -p codex-login --lib`
with incremental/debug data disabled reaches `codex-protocol`, then exits 101
after the compiler hits its explicit 1 GiB data bound. Log
`/tmp/issue-3785-native-login-check.log` lines 501–508 records allocation failure
and SIGABRT. The cgroup reports zero OOM kills. Do not repeat this build under
the same memory budget; retain full native build/manager verification on the
adequately provisioned CI runner.

### Native experiment fetch must use the repository retry wrapper

Checks run 40352383911 at bced52471 fails its lint job. The downloaded job log
`checks-40352383911-lint.log`, lines 3846–3849, identifies the new workflow's
bare `git fetch` as bypassing the shared GitHub retry loop. The existing shell
checker reproduces the failure locally. Route that immutable-source fetch
through `scripts/github-retry.mjs`, retaining the exact source SHA. This is a
workflow lint defect; no native lifecycle result is implied.

### Native workflow cancellation violates the existing release policy

Checks run 40354283383 at 9689667ce9 fails the default suite at file 15/720.
The downloaded completed job log `checks-40354283383-tests.log` lines 482–494
identifies unconditional `cancel-in-progress: true` in the native experiment
workflow. `ci-workflow-cancellation-2082.test.mjs` reproduces that exact failure
locally. Use the repository policy `github.ref != 'refs/heads/main'`, retaining
superseded PR cancellation without cancelling a main-branch dispatch. All 28
focused workflow/task-scope/catalog/restart/session cases pass after repair.
The complete suite and new-head CI must be checked again.

Native experiment 40354283432 on that same SHA compiles the real manager and
passes all five before and after controls, including native login and logout
during refresh. The full CLI also builds and passes native status, replacement,
logout, API-key reauthentication/peer status and environment-key refusal. The
job completes successfully at 2026-10-26 16:20:06 UTC. The retained 470-line
`native-codex-40354283432.log` records native acceptance at line 420, and the
run's separate before/after artifacts are downloaded beside it. These results
do not establish production authority or full lifecycle coverage.

Checks run 40354283383 subsequently completes: Docker, lint and every other
nondependent job pass; only the cancellation-policy regression and dependent
pipeline status fail. The complete run log is preserved as
`checks-40354283383.log`. The repaired setting still needs newest-head CI.

### A new Formal AI release blocks freshness before test admission

Checks 40360472344 was created at 2026-10-26 16:34:50 UTC for
24ef9e65afed8a372df00f8f24190896dd00529b. Its retained completed log
`checks-40360472344.log`, lines 3745–3753, reports eight stale declarations:
the four image defaults and their install commands resolve Formal AI 0.355.11
while crates.io has 0.355.12. All downstream test and Docker jobs are skipped;
they are not passes. Update the four image defaults together, preserving the
existing locked installation and all native CLI pins. New-head freshness and
packaged image verification must run again.


### Actual native synchronous manager verification passes

Native run [40360472411](https://github.com/link-assistant/hive-mind/actions/runs/40360472411)
at `24ef9e65afed8a372df00f8f24190896dd00529b` completes successfully at
2026-10-26 16:57 UTC. Its downloaded 504-line log records seven passing
storage tests at line 342 and the full native CLI acceptance at line 454.
All nine before/after manager logs are downloaded under
`native-codex-40360472411/native-codex-auth-build/`. The four new synchronous
cases reproduce replacement, logout, malformed authority and unsafe permissions
before repair, then pass after the exact-source cached-read patch. The original
five manager cases still pass. This does not certify production integration.

The preceding task-home changes also pass a fresh complete 720-file local
default suite in `/tmp/issue-3785-task-homes-full-retry.log`. Current rollout
publication/filename changes have 37 passing focused cases and four actual
native Docker recovery/read/resume controls; a new 722-file suite is required.
The Formal AI pin repair passes the real local dependency-freshness check and
ten focused freshness regressions. Newest-head CI remains required.


The fresh 722-file local suite exposes an incomplete freshness repair at file
65: `e2e-matrix-harness-3332.test.mjs` refuses mismatched runtime/image versions.
`/tmp/issue-3785-rollout-full-suite.log` lines 974–982 identify the unchanged
`FORMAL_AI_BOOTSTRAP_VERSION` (0.355.11) against image defaults (0.355.12).
The current-pin regression also still expects 0.355.11. Align both declarations
with the four images and rerun the existing pin/matrix tests before restarting
the full suite. This failed run is not counted as a complete pass.

The runtime/image alignment repair passes all ten existing matrix/current-pin
cases and is pushed as b634acbea. Its newest-head CI test-execution, test-suites,
lint, compilation, memory, documentation, security and workflow jobs pass;
Docker image gates and the native auth build remain in progress. A local
722-file retry stops at file 495: the Formal AI Docker fixture reports every
host path absent, which now correctly refuses canonical-history admission.
`/tmp/issue-3785-rollout-full-retry.log` records that structural refusal at
`test-issue-2059-formal-ai-dispatch.mjs:331`. Update its host fixture to provide
only the three required directories; all 36 Formal AI cases pass. A new complete
723-file suite is running with the archive/writer-lock repairs included.

Real native Codex 0.164.0 history controls reproduce duplicate writer ownership
and private archive loss before projection. Both pass afterward, including
explicit native unarchive before resume. All four original format/recovery
controls pass again. Eight new unit regressions and the surrounding selection
pass 41 node:test cases. Both probes now have a pinned stock-native CI job;
installed-package host/nested gates also exercise archives and writer locks.
Those expanded newest-head gates remain unverified until CI executes them.

### Native history CI admission and real model-request controls

All workflows at b634acbea complete successfully, including packaged Docker
and native full CLI build/status checks. Native log 40365835831 is preserved.
At 2bf8f683d, workflow run 40369651991 fails because the stock CLI installation
is outside a lockfile (`workflows-40369651991.log:570`). Preserve the exact npm
tarball URL/integrity in a private experiment package lock and use npm ci.
Native history job 40369651954 exits before its first protocol reply; its
downloaded `native-history-scopes.log` records both startup failures. The probe
discarded stderr, so add bounded synthetic startup diagnostics. It also passed
the cgroupfs-only `/` parent to every daemon; Moby's systemd validation requires
a named `.slice`. Select by the actual Docker cgroup driver and verify this
in CI before attributing every startup failure to that setting. All six local
history controls pass with the locked CLI; its bytes match the earlier binary.

The new real-request control uses a bounded local synthetic HTTP provider and
two long-lived native app servers. The stock CLI retains API-key G0 after
atomic replacement and logout. ChatGPT observes replacement G1, then still
sends G1 after logout. Recreation is checked in the same clients. These are
actual model-request headers classified internally as G0/G1/G2; no request or
credential bytes are logged. The full source-built CLI must pass the new
replacement/logout/recreation control before production integration; manager
unit/control passes alone do not prove that request path.

### Latest-head fixture failure and an unauthenticated request fallback

All five workflows created at 2026-10-26 17:40:35 UTC target
`24c34a39aa30222d441adb6f741f0befff2d6926`. Checks run 40370836788 fails
only its default suite; the complete downloaded log has 49,991 lines.
Lines 49099–49119 identify the stale preflight mount fixture at file 38/723:
`Canonical Codex history storage is unavailable; private fallback is prohibited.`
The packaged Docker job succeeds, including the expanded archive/lock backing
checks. A local continue-on-failure run also identifies the curated-loader
fixture and the runner module's 1,350-line warning threshold. Both fixtures
now provide only the three required history directories; the mount/preparation
API moves into its own module. All 36 focused cases pass; the fresh 723-file
default suite is still running.

Native run 40370836766 builds the full CLI and passes all nine manager controls,
status checks and all six stock history/format controls. Its request test fails;
the preserved artifact initially shows temporary plugin-clone cleanup racing
with a native child. Disable remote plugins before startup and reap the isolated
process group before deleting state. Running the downloaded actual CI executable
then exposes the underlying assertion: after logout the model provider sends
one request without Authorization. Both live clients and both API-key/managed
ChatGPT modes reproduce this with `--expect-unauthenticated-logout`; G1 replacement
and G2 recreation still pass. The source provider permits missing auth to fall
through to an unauthenticated request. A pinned source guard now refuses that
case before an auth-required request; its full native CI build is pending.

Native metadata controls independently demonstrate that even shared SQLite
does not preserve a thread name through resume after private config disposal.
A pinned canonical-index experiment has five passing standalone Rust tests;
native upstream tests and real named read/resume after two disposals are new
required steps in the experiment job. They are pending, not established passes.

### Checkout timeout and a false successful terminal PR status

All 723 selected default test files pass locally after the fixture and history
inspection repairs (`/tmp/issue-3785-history-full-suite-after.log`, exit 0).
Run 40376400576 targets `c1858ca8fd7018bc935df879f0874f5d72e9b1e6`,
created 2026-10-26 18:17:19 UTC. Its 35,047-line downloaded log is retained in
`checks-40376400576.log`. Lines 29150–29152 show checkout fetching all branch/tag
history at 18:18:44 and timing out at 18:28:43 before line-limit verification.
The default tests and packaged Docker job are consequently skipped. Lines
35009–35012 show the terminal gate warning about that cancellation and claiming
success because the ref is a PR. This is not a passing integration run.

The existing CI integrity test is changed to require a failing status for a
cancelled PR dependency; it fails before the repair (actual 0, expected 1 at
test line 94). The gate now fails cancelled dependencies on every ref, including
PRs, and the entire integrity test passes afterward. Request a rerun of the
interrupted checkout job rather than raising its timeout or treating dependent
skips as evidence of success. Native experiment CI continues independently.

### Successful rerun and actual native request/index verification

Attempt 2 of run 40376400576 succeeds after rerunning the interrupted checkout
job. Default and GitHub integration suites, both packaged Docker image checks,
and the terminal pipeline gate pass at the same c1858ca8f SHA. The complete
attempt-2 log is retained as `checks-40376400576-attempt-2.log`. The locally
reproduced cancellation-gate repair is a subsequent commit; this successful
rerun does not exercise its new failure behavior.

Native run 40376400046 also succeeds at c1858ca8f. Its 976-line workflow log is
retained as `native-40376400046.log`; downloaded native diagnostics are under
`/tmp/issue-3785-native-evidence-40376400046/`. The full native CLI compiles.
`native-session-index-tests.log:173-195` records all 20 passing selected tests,
including the five canonical controls and upstream cancellation/rename/scanning
behavior. `native-index-history.log:2` verifies actual name/read/resume and peer
updates after both private configurations are disposed. The before/after real
request logs each pass both API-key and managed ChatGPT modes with two live
clients: repaired admission sends no model requests after malformed credentials,
unsafe permissions or logout, while replacement/repair/recreation still work.

The subsequent provider-override extension and maintenance patch have local
controls but are not part of this CI SHA. Full native history, production
integration and the six-tool lifecycle/deployment matrix remain unfinished.

The subsequent local full native prompt-history build stops at
`/tmp/issue-3785-native-prompt-build.log:444`: a 21,233,680-byte allocation in
Starlark exceeds the deliberately bounded 1 GiB compiler data limit. The log
ends at line 497 with SIGABRT; cgroup OOM and OOM-kill counters remain zero.
Do not repeat the same build. The focused harness compiles the exact native
history modules with only `History`/`HistoryPersistence` value types stubbed;
it reproduces split/lost private history, then passes all 14 positive controls
and all 12 upstream history tests after repair. Retained structural evidence
distinguishes those local results from the full native integration now in CI.

### Alternate native provider constructor admission

The downloaded real CLI from run 40370836766 reproduces four further canonical
auth bypasses through the separate native Bedrock constructors. Bedrock and
Bedrock Runtime each send the synthetic AWS G2 bearer when their ordinary
requires_openai_auth flag is false, and each sends an unauthenticated request
when that flag is true. The eight-case before log, including four no-selector
compatibility controls, is `/tmp/issue-3785-native-constructors-before.log`.
The strict refusal assertion fails in
`/tmp/issue-3785-native-constructors-regression.log` (actual G2, expected no
request). Every endpoint is loopback and no credentials or request bytes are
logged. The source repair now validates provider authority before alternate
constructors can create managers/exporters/gateways, using an inert native
provider for refused configurations. Applicability and formatting are checked;
full native compilation and the positive actual-request controls remain pending.

### Separate CodeQL failure despite successful workflows

At head `3f37d553db39f4a517139650017759d1e0b04a3a`, all five workflow runs
created at 19:09:53 UTC succeed. The independent CodeQL check
[121788863524](https://github.com/link-assistant/hive-mind/runs/121788863524)
nevertheless fails at 19:11:09 UTC with one high-severity alert, 228. Its
downloaded annotation identifies `tests/test-issue-1706-sub-session-size.mjs:34`:
the assertion helper prints values returned from the process environment.
This file is unchanged from main `2498785365`, but the failing PR gate still
requires repair. Workflow success alone did not establish a passing PR status.
Check metadata and annotations are retained alongside this investigation.

`tests/sub-session-size-diagnostics.test.mjs` executes the actual opt-in suite
with three synthetic inherited values, a disposable HOME, bounded child output
and a finite deadline. Installed dependencies replace the network bootstrap.
After correcting the probe's versioned dependency resolution, the test fails
at line 39 because the assertion output contains a synthetic environment value
(`/tmp/issue-3785-codeql-diagnostics-before.log`). The repaired helper keeps
literal test names and counts without printing compared values or exceptions;
the same regression passes afterward. The opt-in suite's existing unrelated
assertion failures remain visible and still produce exit 1. No alert is
dismissed or suppressed. Fresh CodeQL analysis of the repair remains required.

Native run 40384255301 completes successfully at 19:42:58 UTC on the same
3f37d553d head. Its 1,062-line workflow log is `native-40384255301.log`;
native diagnostics are retained under `/tmp/issue-3785-native-evidence-40384255301/`.
`native-request-overrides-after.log:1-10` records eight refusals and both stock
metadata controls. `native-prompt-history-after.log:1-14` records all canonical
history controls; `native-prompt-history-tests.log:19` records 12 upstream
tests passing. Full CLI compilation, 20 native index tests and the actual
named-history disposal/peer-update control with shared SQLite/index/maintenance
also pass. Checks/release run 40384255196 passes all default, integration and
packaged image jobs. The independent CodeQL failure above still prevents a
fully passing PR status.

The downloaded actual CLI independently reproduces TUI execution despite unsafe
canonical history: the healthy canonical-history request passes first, then the
strict zero-request assertion fails at probe line 170. Negative-control and
strict logs are `/tmp/issue-3785-tui-canonical-before.log` and
`/tmp/issue-3785-tui-canonical-regression.log`. Neither the alternate-constructor
repair nor the TUI ordering patch is included in 3f37d553d; both require fresh
full native CI evidence before production use.

Fresh CodeQL check [121817770096](https://github.com/link-assistant/hive-mind/runs/121817770096)
passes on exact head `49e4cf2808de60afaef322558d9cea8d8fb15ebf` at
2026-10-26 20:07:09 UTC with zero annotations. Alert 228's instance for
`refs/pull/3786/merge` is now `fixed`; its main-branch instance remains open.
The most recent PR instance retains the SHA where the finding was introduced,
so the fresh check's head SHA and completion timestamp identify the repair's
analysis. Both check metadata and instance state are retained in this directory.
This verifies the diagnostic repair without suppressing the alert. Other native
and packaged checks are still running or queued at this point.

The fresh local default suite at `49e4cf280` finishes with all 724 selected test
files passing (`/tmp/issue-3785-codeql-full-suite.log`). This includes the new
synthetic inherited-diagnostic regression. Subsequent Qwen changes are confined
to native experiments, their workflow and evidence; their actual manager/client
and writer controls are verified separately and do not establish production
integration or the complete six-tool contract.

Native run [40390941267](https://github.com/link-assistant/hive-mind/actions/runs/40390941267)
fails on exact head `49e4cf2808de60afaef322558d9cea8d8fb15ebf` at
20:28:06 UTC. The workflow log is `native-40390941267.log` (1,039 lines);
the preserved build artifact is
`/tmp/issue-3785-native-evidence-40390941267/native-codex-build.log`
(2,632 lines). Build lines 2581–2632 identify two `E0308` errors in native
`tui/src/app/event_dispatch.rs:175` and `:189`: the experimental returns use
`anyhow::Error`, but the dispatcher returns `color_eyre::Report`. The patch now
uses the same `color_eyre::eyre::eyre!` macro as adjacent native error paths.
Exact-source applicability and rustfmt pass locally; full native compilation
and the repaired TUI/constructor controls must pass in a fresh run. The earlier
full CLI build, 20 session-index tests, unsafe TUI negative control and provider
constructor negative controls completed before this compile failure.

Checks/release run [40390941430](https://github.com/link-assistant/hive-mind/actions/runs/40390941430)
finishes successfully on the same head, including both default/integration test
execution and packaged Docker checks. Security, Workflows, Broken Link Checker
and the independent fresh CodeQL check pass. The native compilation failure
above is the remaining non-passing check on that head.

Security run [40396373241](https://github.com/link-assistant/hive-mind/actions/runs/40396373241)
on exact head `c1bfa9c6ceea0dc2e1b8f5ac9b5c0b856f47fb12` fails Dependency
Review at 20:44:47 UTC. The separate job log
`dependency-review-40396373241.log:213–215` identifies `sharp@0.35.4` in the
new locked Qwen experiment package and high-severity
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
The advisory's first patched version is 0.35.5. Pin an override to that exact
version and regenerate its platform/libvips lock entries. Qwen stays at 0.26.1,
with identical inspected bundle hashes; production dependencies are unchanged.
A fresh `npm ci --ignore-scripts --omit=optional` and `npm audit` pass with zero
advisories. All actual native read/client/writer and new CLI/factory controls
pass again after reinstalling. Fresh Dependency Review remains required.

Native Qwen run [40396374276](https://github.com/link-assistant/hive-mind/actions/runs/40396374276)
passes at c1bfa9c6c. Its downloaded diagnostics confirm 14 manager reads,
14 actual OAuth-client reads, private-root kernel-lock ownership and all 11
native OAuth writer/failure cases. This run precedes the newer CLI provider
admission controls; those require their own fresh run.

## Recovery on 2026-10-30

The five most recent runs were created at 2026-10-26T20:31:15Z for exact head
`c1bfa9c6ceea0dc2e1b8f5ac9b5c0b856f47fb12`. They precede the recovered commits.
The two failing runs were downloaded again without relying on cached status.

`security-40396373241.log:7400–7403` confirms the vulnerable Qwen experiment
`sharp@0.35.4` dependency. The already-tested 0.35.5 override was stranded on
`recovery/issue-3785-4c28551ac612` and is restored to the PR branch.

`native-codex-40396373397.log:940–951` shows successful native compilation,
then failure in the actual TUI control. Its downloaded
`native-codex-auth-build/native-tui-history-after.log:1–29` establishes that
both healthy history and unsafe-history refusal **passed**. The failure is
`OSError: [Errno 39] Directory not empty: 'plugins'` during fixture removal.
The probe killed its process group only while the CLI leader was alive; a
leader exiting on refusal left catalog helpers writing after cleanup began.
A finite regression starts a helper, exits its leader, then checks termination.
It fails before repair (live sleeping descendant) and passes after unconditional
process-group termination and bounded waiting for live members to disappear.
The actual downloaded native CLI passes healthy/refusal controls and both
no-selector compatibility controls after this repair. The child is reaped before
fixture removal; temporary-directory errors are not ignored or retried away.

The interrupted log identifies three preserved commits beyond the PR head:
`361e30057`, `244916565`, and `90f6cb5e`. All are cherry-picked after merging
current `main`, preserving their original history. The last contains unverified
Codex refresh-crash intent work. Its exact-source applicability and seven
storage/owner-death tests pass locally; full native manager/CLI execution remains
required in CI. The newer native Qwen CLI/factory tests also need fresh CI.

The requested suspected model false-positive report is
[openai/codex 58320](https://github.com/openai/codex/issues/58320). It records
historical error/turn-failure timestamps, the synthetic maintenance context,
recovery evidence and the absence of a minimal deterministic classifier trigger.
No classifier bypass or automatic policy-error retry is proposed.

The complete recovered execution trace is retained as
`docs/case-studies/issue-3785/evidence/interrupted-session.log.gz` (manifest SHA-256
`f6845a76460d51177defb4e50d7371c3a027bed52fff0fb1449fc9e691259d4a`, measured
on uncompressed sanitized content). Recovery streamed the 46,426,314-byte source
through credential and identity sanitizers in 64 KiB blocks, then required a
second scan with no residual credential block. The publication sanitizer must
reach a fixed point in at most four passes per block; non-convergence refuses
publication. The scripts retain structural diagnostics without printing matched
credential values.

The recovered refresh-intent module has an additional local regression. After
recording an uncertain G0 exchange, safe malformed auth JSON made transaction
acquisition return `Canonical refresh outcome is unresolved or unsafe`, blocking
explicit native login before it could repair the JSON. The before test fails at
`explicit_reauthentication_can_repair_malformed_auth_without_clearing_uncertainty`;
all other six transaction tests pass. Reconciliation now leaves uncertainty
intact when generation parsing fails while allowing the lock owner to publish
fresh credentials. Requests and another refresh still refuse the broken store.
All seven exact-module tests pass with real pinned JSON/hash/Tokio dependencies.
The native workflow adds both a small dependency-subset job and an actual CLI
login-after-owner-death control. Full native CLI repair remains unverified until
that job runs; it is not inferred from the module result.

Local Docker execution currently fails before any probe starts: runc reports
`cannot enter cgroupv2 "/sys/fs/cgroup/docker" with domain controllers -- it is in an invalid state`.
This is a local runner limitation, not a passing lifecycle test. The official
workflow's actionlint and ShellCheck binaries were extracted from its pinned
image without starting a container; the changed native workflow passes both.
No cgroup/resource limit was relaxed to make a probe run.

The actual pinned Qwen OAuth writer has a related consumed-predecessor defect:
`qwen-metadata-before.log:6–14` records an unexpected second exchange after an
unknown first outcome and an atomic rewrite changing only expiry/metadata.
The old intent hashes JSON content, so a metadata change clears uncertainty.
Intent format 2 hashes the refresh token, retains uncertain/legacy evidence,
and permits a non-rotating success only in the transaction that began its
exchange. All 14 native writer controls pass in `qwen-writers-after.log`.
The 14 manager reads, 14 actual-client reads, private-config kernel-lock probe,
actual CLI provider refusal, all factory/retained-handle refusals and both
legacy/sunset controls also pass locally after this repair. These are disposable
native experiments; production integration remains open.

Router sidecar admission now has a reproducing production regression:
`router-storage-before.log` fails all 15 authority-override cases; unrestricted
extra Docker arguments can replace the declared audit environment or volume.
Resource-only arguments are now bounded and validated before any Docker action.
The actual new/reused sidecar is inspected before task-token issue: canonical
DATA_DIR/AUDIT_LOG declarations and exactly one writable canonical named volume
are required, with no overlapping mount. Missing, duplicated, redirected,
read-only, bind and tmpfs storage all refuse without printing inspection values.
`router-storage-after.log` passes all 51 new controls and the existing issue
2164/2190 lifecycle suites (53 Node test entries, zero failures). This validates
the declared storage, not audit contents, full conversations, or the external
Router contract; A8 remains partial.

The refreshed local default suite contains 727 files before the Router file was
added. Files 1–549 pass in `all-tests.log`; file 550's bounded worker containment
checks fail under a global NODE_OPTIONS old-space setting, which overrides the
worker's explicit resourceLimits. Retrying from that same file without the
process-wide setting passes all remaining 178 files in `all-tests-resumed.log`.
No failed test is skipped. The retained resume utility supports an explicit
saved-list retry for this environment correction. The new Router file and both
affected older Router files pass separately after the production change.

The executable from native run 40396373397 also passes all eight actual
Bedrock/Mantle and Bedrock Runtime constructor cases locally: canonical selection
refuses both alternate and missing credentials before model execution; each
no-selector control preserves native behavior. Evidence is retained in
`native-constructors-current.log`. The repaired refresh-intent CLI still needs
a fresh native build; this older executable does not contain that work.


Fresh native Qwen run [41051640593](https://github.com/link-assistant/hive-mind/actions/runs/41051640593)
passes at 7f4f4c645 (created 2026-10-30T11:56:12Z, job execution
12:11:16–12:12 UTC). The 421-line job log is preserved locally as
`ci-logs/native-qwen-41051640593.log`. Downloaded artifact
`native-qwen-auth-experiment` confirms all 14 writer scenarios, five provider
modes, six OAuth overrides, 15 retained-handle method refusals, actual CLI
zero-request refusal, and no-selector/OAuth-sunset controls. This closes fresh
verification for the experimental Qwen changes, not its open production/current
API-key/history requirements.

The subsequent native Codex writer audit reproduces another real publication
race. Pause actual CLI agent registration under synthetic legacy G0 credentials,
then atomically replace the canonical login with another account or an API key.
The writer's existing comparison runs only when G0 has login_owner_id; otherwise
it adds G0's private identity record to the replacement login. Eight actual native
CLI controls pass in `evidence/native-identity-before.log`: three stale-publication
reproductions (including a newly owned same-account login), healthy and rotating
controls, logout and both owner-tagged replacement refusals. No old-account model request is observed. The strict
regression fails at `A stale identity must not be published into a replacement
login.` in `evidence/native-identity-strict-before.log`.

`build_identity_publication_tests.py` extracts the exact native writer and login
comparisons with mocked storage/lock fixtures. Before repair,
`native-identity-unit-before.log:3,5,6` identify API-key, legacy-account-switch
and newly owned same-account login failures (8 pass, 3 fail). The hash-pinned `apply_identity_publication.py` adds a
canonical-only matching-login check before metadata publication; all eleven focused
controls pass in `native-identity-unit-after.log`. The workflow now requires the
strict actual CLI before/after controls as well. Full native CLI positive proof
remains pending and is not inferred from the mocked-storage result.


At head `7f4f4c645`, [Checks and release 41051640573](https://github.com/link-assistant/hive-mind/actions/runs/41051640573)
failed dependency freshness at 2026-10-30T12:08:46Z. The preserved 4547-line
`checks-41051640573.log:4094–4127` identifies 30 stale declarations/lock entries:
Formal AI, act, four deliberately pinned native CLIs, lino-objects-codec and
seven allowed-range lockfile entries. Downstream test/image jobs were skipped.
Formal AI 0.355.23, act v0.2.92, lino-objects-codec 0.9.4 and the allowed-range
lockfile were refreshed against their live publishers. Each deliberate native
CLI pin now names open issue 3785 on its declaration line, using the existing
verified-open-issue exception policy. Their exact-version runtime manifests and
native adapters must be upgraded together. No freshness gate was weakened.
The enforcing local check passes: 195/208 current declarations, 13 verified
exceptions (12 native CLI locations plus the existing Router hold), zero
lockfile lag. Fresh CI remains required; the updated-dependency suite result is
recorded below.

The same head's [native Codex run 41051640537](https://github.com/link-assistant/hive-mind/actions/runs/41051640537)
builds both full CLI stages and passes native transaction/history jobs, upstream
session-index/prompt-history tests, actual TUI refusal and native refresh
owner-death/login repair controls. The request job fails at 12:39:53Z
(`native-codex-41051640537.log:1053`). Its downloaded `native-request-after.log`
shows no initial G0 request in ChatGPT mode. This is reproduced locally with the
actual artifact. Opt-in bounded native traces reveal initialization's default
catalog discovery contacting the real default service before the fixture's
per-thread loopback override, receiving a 401, then leaving an uncertain refresh.
These are synthetic credentials, but the fixture's earlier loopback-only claim
was too broad. Configure the synthetic provider at startup, route its catalog
locally, and reject external proxy CONNECT requests and undeclared endpoints.
Retain the same two-live-client assertions; do not bypass uncertainty admission.
The production adapter is unchanged by this fixture correction.

The actual pinned Claude 2.1.310 executable passes five host request/writer
controls: healthy G0, expired G1, concurrent private configurations sharing one
refresh, and fresh-login/logout during a paused response. A separate owner-death
negative control consumes G0, kills/reaps its native owner and observes the peer
reuse G0. The strict assertion fails at `A peer must refuse the consumed
predecessor after owner death.` See the retained structural log and native Claude
README. The loopback-only HTTPS proxy never forwards, uses child-scoped
certificate trust with TLS verification enabled, and all inputs are synthetic.
This does not establish the real provider's grace/replay policy. Native crash
semantics, production integration and the complete Docker matrix remain open.


After startup/provider routing and proxy confinement are corrected, the downloaded
actual executable from 41051640537 passes both two-client auth modes, all eight
provider refusals/two metadata controls, all eight constructor/legacy cases,
actual crash/login repair and both TUI controls. The eight identity scenarios
retain their expected pre-repair results, including all three stale publications;
no regression assertion was removed. Results are preserved in
`evidence/native-network-controls.log`. Eleven focused identity writer tests pass
with the new repair; actual repaired full-CLI verification remains pending.


The refreshed-dependency default suite passes all 728 files in two batches.
`all-tests-refreshed-dependencies.log` passes files 1–542, then stops at
`tests/test-issue-2187-current-dependency-pins.mjs` (file 543): its existing
Formal AI fixture still expects 0.355.15. Updating the assertion to the new
0.355.23 pin and retrying that same file through file 728 passes all 186
remaining files (`all-tests-refreshed-resumed.log`). No file was skipped; no
global Node heap override was used. ESLint, full Prettier, secret scanning,
changeset validation, file limits, actionlint/ShellCheck and duplication
(10.06%, limit 12%) pass. Final enforcing freshness again reports zero lag.

The actual native Claude completed-history control separately passes: a first
synthetic SSE completion writes a transcript; after both private roots and the
entire native process group are removed, a fresh native peer resumes and sends
the prior message in its successful model request. Sharing only projects/sessions
retains the transcript; private-history disposal produces the specific native
missing-session error and the strict regression fails. Both requests use G0
with zero refreshes. Structural positive/negative results are retained in
`evidence/claude-native-history-controls.log`. This verifies host native resume,
not Docker, complete history stores, deployment or the unresolved crash contract.


The Qwen 0.26.1 history probe now completes two actual native requests with
private-home/configuration disposal between them. Shared QWEN_RUNTIME_DIR
retains native session identity, transcript and prior messages in the resumed
model request. Private runtime disposal reaches native missing-session discovery;
the strict resume assertion fails. Positive/negative structural results are in
`evidence/qwen-native-history-controls.log`. The fixture uses explicit synthetic
API-key auth with no canonical OAuth selector and never forwards its proxy.
This is host history evidence, not canonical current-provider authentication
or production projection. Native Storage also locates generated executable
workflow scripts under runtime; pinned context overrides, plans/audit fallback
and all lifecycle boundaries remain open.

GitHub refuses `gh pr diff 3786` with HTTP 406 because the PR exceeds 300
changed files. The complete local `git diff origin/main...HEAD` is retained
locally for review; the branch contains current main without rewriting history.
Fresh runs at 254e5901e were created at 2026-10-30T13:12:45Z; queued native
jobs have no logs yet. No queued state is counted as a pass.

## Fresh native failures at 2347ebdf5 (2026-10-30)

Runs were created at 13:19:14 UTC for exact head
`2347ebdf5cb2148d27b89a51f69fb2bda4ce30a4`.
Native Qwen run 41062245341 passes, including all existing auth controls and
actual completed-history/private-disposal/resume positive and negative controls.
Downloaded workflow log: `ci-logs/native-qwen-41062245341.log` (439 lines).
Its history artifacts retain prior messages on shared runtime and specifically
reach native missing-session discovery after private runtime disposal. This
still does not implement a canonical current-provider auth adapter.

Codex job 124084688284 in run 41062245561 fails after reproducing the three
expected original identity cases. The job log was downloaded through the jobs
API while the other jobs were still running. In
`ci-logs/native-codex-intent-41062245561.log`, lines 272–283 install only the
minimal Rust profile; lines 339–350 show expected regressions followed by the
pinned rustfmt subprocess failing. Both compiler setup steps now explicitly
install the rustfmt component required by the identity applier. The full CLI
job was still running at inspection; no pending result is counted as success.

A separate actual CLI regression replaces ChatGPT credentials with explicit
API-key mode while retaining the previous OAuth token object. Token comparison
alone still permits stale identity publication. The strict actual CLI assertion
fails; the previous focused repair also fails this new case (11 pass, one fail).
Require the canonical resolved mode to remain ChatGPT as well as matching the
originating login. All twelve focused cases pass afterward. Nine actual
pre-repair controls reproduce four stale publications; rebuilt CLI positives
remain pending. Structural evidence is in
`evidence/native-identity-mode-controls.log`.

Claude run 41062245476 verifies the exact pinned binary digest, native storage
selection and all five healthy/writer controls, then fails in the owner-death
fixture. Workflow log `ci-logs/native-claude-41062245476.log`, lines 291–306,
locates the failed step; artifact `claude-owner-death.log`, lines 1–7, reports
`Synthetic request validation failed: ['SSLEOFError']` after two refresh requests.
The first response was intentionally held until its native owner was killed.
Handle TLS EOF/broken-pipe/reset only while sending that specific response after
the owner has been reaped; retain failures for peer/other requests and all other
TLS errors. Repeated actual owner-death controls pass after the fixture repair,
while the strict consumed-predecessor assertion still fails. This fixes fixture
accounting, not the unresolved native crash guarantee.

## Fresh native results at 69b1e8a46 (2026-10-30)

The runs created at 13:32:15–16 UTC use exact head
`69b1e8a464adcfef8c00223652924870de178ce0`. Claude run 41064060494 and
Qwen run 41064059810 pass. Claude retains the expected native owner-death
defect and a separately failing strict assertion; a green experiment does not
establish the crash guarantee. Codex run 41064060039's transaction job passes
all seven native transaction controls and all twelve focused identity cases.
Its full CLI integration job is still pending at this inspection.

The same Codex run's history job fails at 13:40:13 UTC. Preserved job log
`ci-logs/native-codex-history-41064060039.log:310–317` identifies the stock
request negative control. Its `native-history-request-before.log` artifact
reports ChatGPT replacement returning G0 where the fixture expected G1. The
exact stock 0.164.0 executable reproduces this locally. Native AuthManager
explicitly caches both auth modes until reload; selecting the local startup
catalog removes the unrelated request that previously caused a reload.

The stock negative control now requires stale G0 after replacement, logout
and recreation in both modes. The repaired path's requirements are unchanged:
G1 after replacement, no model request after logout or malformed/unsafe state,
and G2 after recreation, with two live clients per mode. Both exact-stock and
downloaded repaired-CLI controls pass locally, with zero external forwarding.
Structural results are retained in `evidence/native-stock-request-controls.log`.
Fresh native CI remains required for this fixture correction.

## Head 1c183b347 and compression follow-up (2026-10-30)

Native Codex run [41070646110](https://github.com/link-assistant/hive-mind/actions/runs/41070646110),
created at 14:18:01 UTC for `1c183b3475cf94dc99073820d46a1747cbf68947`,
passes all three jobs, including the corrected stock-history control and full
compiled CLI integration. Claude, Qwen, Workflows, Security and links also pass.

Checks/release run [41070646208](https://github.com/link-assistant/hive-mind/actions/runs/41070646208)
fails at dependency freshness. Downloaded `checks-release-41070646208.log`
lines 4116–4126 identify newly published Formal AI 0.355.24 and ESLint 10.14.0.
Commit `f649e1469` updates all four image pins, the bootstrap version, package
and lockfile, and the existing contract assertion. Local freshness and full
ESLint pass. Skipped downstream jobs are not counted as tested at this head.

The complete 732-file local default suite passes. Eight directory-preparation
regressions and 44 related tests pass again after the later helper; the six
pre-repair failures preserve their synthetic evidence.

A new actual-native compression lifecycle test reproduces a separate remaining
history defect. Canonical maintenance exclusion and active/archive compression
work with the intermediate adapter, but native SQLite stores a private config
alias; deleting both configs makes fresh resume fail while canonical compressed
history remains intact. The new exact-source SQLite path projection passes nine
standalone Rust controls; full compiled before/after verification is required
in the next run. Production canonical storage remains unfinished.

## Head 67da7a592: native success and packaged payload failure (2026-10-30)

Native Codex run [41076013002](https://github.com/link-assistant/hive-mind/actions/runs/41076013002),
created at 14:55:52 UTC for `67da7a5927f4ac2272a85557d845860a445be5d9`,
passes all three jobs. The compiled SQLite path adapter passes actual active
and archived compression, private-configuration disposal and fresh resume.
The selector-absent negative control still reproduces private metadata.

Checks/release run [41076013051](https://github.com/link-assistant/hive-mind/actions/runs/41076013051)
passes dependency freshness, lint, compilation and all test jobs. Packaged
Docker fails after its host-backed Codex mount check succeeds. Downloaded
`checks-release-41076013051.log` lines 67230–67243 locate the failure at the
first Agent/OpenCode installed-validator invocation. Its private child log
was removed with the disposable container, so CI does not expose the inner
exception at this head.

The exact generated validator payload reproduces `ERR_MODULE_NOT_FOUND` in
an empty working directory: the newly imported `storage-directory.lib.mjs`
is absent in the small Node task image. Carry that installed dependency as
a data-URL module with the validator, without requiring a package checkout
inside the task. The before test fails at the missing import; the after test
and five related gate/selection cases pass. Failed synthetic gate diagnostics
are now copied out before container removal and retained as a CI artifact.
Actual packaged host/nested confirmation remains required in the next run.

The local 733-file attempt stopped at file 506 because the Formal AI mount
fixture omitted the newly required migration-journal directory. Its 36 tests
pass after supplying that directory. A fresh 734-file default suite is running;
the subsequently added validator-payload regression is verified separately.

## Exact-head c7a6e20aa: workflow warning threshold

The checks run [41082125451](https://github.com/link-assistant/hive-mind/actions/runs/41082125451),
created 2026-10-30 15:35:31 UTC, fails its default suite at file 69/735.
Downloaded the completed job through the Actions jobs/logs API while the image
job was still running; its preserved local log is
`ci-logs/test-suites-41082125451.log`. Lines 1287–1306 identify
`tests/extracted-modules-2198.test.mjs:48`: `release.yml` has 1,354 lines,
above the 1,350-line early-warning guard. The separate shell line-limit job
passes because it fails only above 1,500; its passing exit was insufficient.

The exact regression fails locally before repair. Remove the duplicate inline
base-image reporting step: `scripts/docker-pr-build.sh` already reads both
Dockerfiles, refuses missing pins before building and prints both selected base
images. Keep that script invocation and the new diagnostic artifact upload.
The workflow is reduced to 1,344 lines without removing image validation.
Rerun the existing extraction guard, release-order and image workflow controls.
The full local suite started before the upload step was added and must be
reported with its actual selected 734 files; the newest payload test passes
separately. Fresh complete CI must cover all 735 selected files after repair.

Local verification after repair: the existing extraction warning guard and
release-order contract pass; all six release/image-selection controls pass.
The complete local 734-file default run has now finished successfully. The
new payload test (added after that run selected files) and updated packaged
gates pass separately. No local native CLI rebuild was attempted.
