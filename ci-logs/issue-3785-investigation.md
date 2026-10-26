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
