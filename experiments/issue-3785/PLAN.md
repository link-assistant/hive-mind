# Issue 3785 implementation and verification plan

Objective: implement every issue/comment requirement in PR 3786; preserve history,
push only issue-3785-4c28551ac612, and keep unmet requirements explicitly open.

- [x] Read full issue, both comments, PR conversation, inline comments and reviews;
      check required sub-issues (none returned by GitHub).
- [x] Check branch, working tree, contributing instructions and resource budget.
- [x] List recent CI runs with SHA/timestamps; preserve unavailable-log evidence.
- [x] Preserve related logs/images, validate image types, and inspect screenshots.
- [x] Research Claude entitlement/expiry and Codex storage/rotation upstream sources.
- [x] Inventory initial versioned storage interfaces for all six installed CLIs;
      distinguish source findings from actual lifecycle/coordination verification.
- [x] Reproduce native Qwen refresh-lock ownership loss with its installed token
      manager and mocked OAuth in separate processes; verify an exiting non-owner
      permits duplicate G0 exchange while a control peer rereads committed G1.
      Native coordination remains unfinished; preserve the source/version limits.
- [x] Report native Qwen ownership defect upstream with immutable reproduction
      and control; keep production coordination explicitly unfinished.
- [x] Inventory every acceptance criterion in docs/case-studies/issue-3785.
- [x] Trace limits rendering, credential selection/refresh, task preflight,
      mounts, resume/recovery, image startup and deployment paths.
- [x] Reproduce layout and credential divergence with synthetic automated tests
      before changing implementation; keep probes here and bound their resource use.
- [x] Fix Claude section layout, entitlement detection and honest stored metadata.
- [x] Partition cache by effective home and credential generation; invalidate on logout.
- [x] Reproduce full-suite failure from same-size credential rewrites sharing
      coarse filesystem timestamps. Add a bounded internal content digest; the
      finite rapid-rewrite regression fails before repair and 26 cache/limits
      tests pass afterward. The next full run stops at file 253 because the
      queue fixture seeds success without a credential generation; supply a
      disposable empty credential file and pin its independent Claude selector.
      All 71 queue assertions pass. Restart the complete suite again.
- [x] Read selected Router usage authority without local vendor fallback.
- [x] Reject selected Router launches without valid task token, endpoint or tool route.
- [x] Keep Codex marketplace discovery in task-owned state; remove root catalog link.
- [x] Remove sensitive diagnostics, including malformed JSON error excerpts.
- [x] Reproduce legacy global-audit malformed/link/permission/concurrent-edit
      failures; reject unsafe inputs before repair without logging input bytes.
- [x] Add bounded real Codex logout/login Docker probe and report evidence upstream.
- [x] Reproduce overlapping refresh with two actual CLIs and a synthetic provider.
- [x] Reject known remaining audit findings before native connection checks in
      solve/hive/root bot; validate TOML and bound reads despite concurrent growth.
- [x] Reproduce semantic TOML audit/repair bypasses before fixing discovery;
      verify quoted/dotted/inline entries, nested tables and typed preservation.
- [x] Reproduce known global instruction/hook/profile/agent admission gaps;
      reject them and verify safe repairs preserve credentials and clean profiles.
- [x] Resolve newest-head CI queue-test failure from downloaded job logs; rerun
      all default tests and checks after the current audit/admission changes.
- [x] Reproduce pending usage requests crossing cache resets; scope request
      coalescing by cache instance and isolate manual queue unit tests.
- [x] Reproduce arbitrary `.system` admission; pin Claude/Codex image versions
      and compare stock against repeated pristine real-CLI manifests.
- [x] Verify one real Codex external-token callback after a synthetic 401;
      retain the internal/unstable schema warning and unverified lifecycle limits.
- [x] Extend that experiment to two actual app servers and callback workers in
      separate containers. Reproduce duplicate predecessor exchanges without a
      lock; verify one exchange after locked generation reread, next-request G1,
      shared lock identity and release after forced owner-container removal.
      This remains an experimental adapter, not production/all-writer support.
- [x] Extract the callback experiment's OS lock into a packaged Linux primitive.
      Verify ten cases: independent processes reread G1 and exchange G0 once,
      forced owner death preserves the inode, rejected callbacks release,
      waiting deadlines/abort reap children, unsafe links/modes and replacement
      refuse exchange/commit. Rerun both real two-container callback controls
      using this exact module. Direct native/host writers remain unfinished.
- [x] Reproduce PR checks installing published latest; pack the branch and require
      installed stock-runtime verification in root/DinD/Coolify build definitions.
- [x] Reproduce Playwright-name command/environment spoofing and native Claude
      state relocation; reject unapproved registrations before unrelated repair.
- [x] Reproduce automatic updates defeating image CLI pins; exclude Claude/Codex
      using the updater's existing per-tool setting and preserve all other targets.
- [x] Reproduce parent-environment inheritance in stock-gate children; isolate
      all native version and materialization subprocesses in disposable state.
- [x] Reproduce real Codex discovering an extra admin skill beside pristine
      stock; require the exact pinned native catalog as well as file hashes.
- [x] Reproduce host-socket mount sources left in the root namespace; translate
      persisted bind/volume paths and verify actual backing before fresh launch.
      Check direct paths, private-layer rejection, partial mountinfo reads,
      missing-image pulls and refusal before task execution with synthetic state.
- [x] Add a required installed-package mount check to PR image verification for
      host/nested daemons, with two synthetic filesystem writers and peer-failure
      cleanup tests. Actual packaged-image execution must still pass in CI.
- [x] Reproduce skipped image verification on source/gate-only updates; include
      packaged runtime, dependency and image verification inputs in detection.
- [x] Reproduce clean-home audit bypasses through explicit tool-home overrides;
      validate both conventional and selected roots before repair/admission,
      including unsafe ancestors, concurrent edits and changed path selectors.
- [x] Reproduce local system/managed configuration bypasses before changing
      admission; inspect managed settings/drop-ins/MCP and Codex system/legacy/
      requirements files without editing security policy. Reject unsafe links,
      malformed/oversized/changed state and unapproved admin payloads. Verify
      actual pinned Codex system-MCP discovery with a bounded offline probe.
      Refuse unattested dynamic policy helpers/config servers without running
      helpers, fetching remote policy or rewriting administrator files.
- [x] Trace the first required packaged host-mount timeout; supply and execute
      the missing explicit Docker client in host-socket image definitions, add
      fail-fast client diagnostics and verify the copied binary unprivileged.
      Await the actual new-head packaged host/nested CI gate.
- [x] Resolve local suite isolation and stale detector assertions; restore the
      operator plugin caches affected by an inherited test selector and verify
      the worker containment probe without a conflicting global heap override.
- [x] Reproduce cloud capability rehydration defaults and selected-home writes;
      pin Claude account skills/plugins sync, connectors and marketplace policy
      before admission. Reject absent policy with repair disabled, safely seed
      missing settings and remove restored synced plugin payloads. Preserve
      protected state and managed policy; verify actual configure-command paths.
      Authenticated native cloud rehydration remains part of the image matrix.
- [x] Reproduce Coolify hiding startup failure and skipping restored-home
      validation before its setup terminal. Require installed read-only runtime
      validation and preserve nonzero startup status; verify the actual shell
      payload with mocked external commands. Full packaged deployment, migration
      and canonical-storage attestation remain required.
- [x] Reproduce missing Agent/OpenCode native data projections before adding
      directory mounts, effective-path/device/inode admission and private agent
      executable-cache masking. Pin both layouts in images and runtime checks.
      Verify actual Docker atomic replacements, deletion/recreation and peer
      writes; verify both real CLIs resume native history across private homes.
      This is partial storage projection, not a refresh coordinator or full gate.
- [x] Reproduce independent Claude credential-root, empty-selector and NFC
      mismatches in `/limits`; follow native precedence and verify actual pinned
      Linux status/logout using synthetic credentials and private configuration.
      Full native auth/history projection and refresh remain unfinished.
- [x] Resume the externally interrupted 714-file default suite at its incomplete
      file; all 88 remaining files pass. Verify newly added release tests and
      later Claude changes independently.
- [x] Reproduce Router guard bypasses through selected Claude config/auth roots,
      relocated account state and settings redirects; share native path selection
      with `/limits` and retain transient-state behavior. Full Router contract open.
- [x] Reproduce missing/broken Agent search acceptance and actual Docker search
      failure with the executable-cache mask. Install the pinned architecture's
      bundled search command in all images, verify actual masked task execution,
      and require image checks for installer-script updates. Packaged CI pending.
- [ ] Implement canonical auth/history authority, explicit alternative contracts,
      coordinated refresh and fail-closed effective-path validation for all tools.
      Start a native Codex file-store source adapter at immutable 0.164.0:
      native status fails before the adapter; standalone Rust primitives compile
      and pass. Keep it outside production until the full native CLI build,
      refresh/read/write coordination and lifecycle gates are verified. Preserve
      `--locked` after hash-checked repair of local workspace version entries.
      Prepare exact-source manager transaction/cached-read patch and real
      two-process provider-stub negative/positive controls. Syntax/applicability
      pass; native compilation exceeds the bounded local compiler allocation,
      so actual before/after controls must run in CI before production use.
      Include login/logout during a paused native refresh; verify both process
      results, one exchange and the final canonical writer state. Keep the full
      CLI reauthentication and environment-override checks in the same job.
      CI 40354283432 at 9689667ce9 compiles the actual manager and full CLI;
      all five negative/positive controls and full native status/replacement/
      logout/reauthentication/environment-refusal checks pass. The synchronous
      request-header auth_cached() path still needs invalidation; reproduce it
      before repairing it. Production integration remains open.
      Prepare a third, exact-intermediate-hash source patch: require four native
      synchronous-read negative controls after async coordination, then require
      all nine manager controls after the new patch. Cover replacement, logout,
      malformed authority and unsafe permissions. Preserve the pre-lock cached
      generation comparison and enforce login/workspace restrictions. Local
      syntax and applicability pass. CI 40360472411 compiles the actual native
      manager and full CLI; all nine before/after controls, seven storage tests,
      and the native status/replacement/logout/reauthentication/refusal probe
      pass at 24ef9e65a. This remains experimental, outside production.
- [x] Reproduce scoped Codex config inheriting six alternate plugin-table forms,
      corrupting header-looking multiline strings and admitting malformed TOML.
      Replace regex stripping with semantic parsing; preserve typed runtime
      values and reject malformed input without private parser diagnostics.
- [x] Reproduce two same-repository tasks reusing one mutable Codex home and
      a linked allocation namespace reaching operator state. Allocate private
      fresh homes outside the operator tool directory for normal and degraded
      preflights; preserve another active task and clean up preflight failures.
      All 28 focused task/catalog/restart/session/workflow cases pass. Retain
      successful execution homes until full native history/SQLite projection
      exists. The pinned native CLI passes the bounded Docker catalog probe
      with concurrent different-capability checkouts. Refuse failed sessions
      sharing and recover canonical rollouts before legacy scoped rollouts;
      28 focused recovery/config/preflight cases pass. Execution cleanup and
      the full native execution lifecycle remain open.
- [x] Reproduce separate native Codex profile-v2 files bypassing base audit;
      validate bounded enumeration, unsafe inputs and concurrent additions before
      repair. Verify the actual pinned CLI discovers the separate-file MCP and
      read-only admission refuses it; 193 surrounding tests pass.
- [x] Reproduce missing Gemini/Qwen image and update pins and runtime version
      admission. Pin all six CLIs; verify actual Gemini 0.65.0, Qwen 0.26.1,
      Agent 0.27.0, OpenCode 1.19.4 and search versions in disposable state.
      Version checks alone do not establish the requested storage contract.
- [ ] Isolate task catalogs/extensions and enforce clean global baseline; migrate
      persisted full homes with an allowlist preserving auth/conversation evidence.
- [ ] Add production Docker lifecycle tests (root/two tasks, refresh/atomic writes,
      history/resume, overrides/contamination, cleanup, host/nested daemon layouts).
- [x] Reproduce publication allowing a skipped PR-only Docker dependency. Run
      the existing branch-package gates for main publication candidates and
      require their exact success in both publishing jobs; preserve PR selection.
      Verify actual condition/event combinations and existing release contracts.
- [ ] Require the complete native lifecycle/image/deployment matrix for release.
- [x] Capture reproducible before/after display evidence and document root causes,
      timeline, upstream findings, solutions and exact outstanding blockers.
- [x] Run focused tests then full local suite, lint/format and relevant checks
      sequentially; preserve large logs and inspect failures in <=1500-line chunks.
      The complete 720-file local default suite passes after the credential-cache
      generation and disposable queue-fixture corrections. The current task-home
      changes pass a fresh complete 720-file run. The native source adapter
      build and named full-CLI acceptance cases pass in run 40354283432.
- [x] Commit useful atomic steps after checks; integrate latest main; review diff.
- [x] Update PR title/body with evidence, reproduction and Fixes #3785; push branch.
- [ ] Verify newest-SHA CI, download/analyze nonpassing logs, fix actual failures.
      b634acbea passes every CI workflow, including packaged Docker and the
      native full CLI. At 2bf8f683d, workflow security rejects the new unlocked
      stock CLI install and native history containers exit before protocol
      replies. Preserve both diagnostics; lock the exact npm tarball and add
      bounded process diagnostics. Select the cgroup parent by the daemon's
      actual driver: systemd rejects the cgroupfs-only "/" parent. All six local
      native history controls pass again with the locked, byte-identical CLI.
      Reproduce actual stale authorized model requests after logout in two live
      stock CLI processes for both API-key and ChatGPT modes. API keys also
      retain stale G0 after replacement/recreation; ChatGPT replacement already
      observes G1. Add actual full-CLI request controls after the native adapter
      build, requiring replacement/recreation and no model request after logout.
      Those positive controls remain unverified until the full native CI build.
- [x] Reproduce legacy and stopped-container rollout recovery overwriting a
      concurrent canonical writer. Stage and sync copies before exclusive
      publication, retain original/conflicting evidence, refuse linked targets
      and verify no partial copy has a native rollout filename. Five new cases
      and 27 surrounding recovery/config cases pass. Reproduce rejection of
      compressed/reverted native filenames in three additional failing cases;
      all five format cases pass after repair. Pinned real Codex reads/resumes
      all four formats before and after actual stopped-container docker cp
      recovery, with original bytes/filenames reset after the native control.
      All 37 focused cases and lint pass. The 722-file retry stopped at the
      Formal AI Docker fixture, which reported every canonical history directory
      missing. Supply only the three required directories in that fixture;
      all 36 Formal AI cases pass. A fresh 723-file run is in progress.
- [x] Reproduce native Codex private writer locks admitting two active owners
      and thread/archive moving a transcript into disposable configuration.
      Project native archives and writer locks alongside sessions, preserve
      archived recovery location and refuse missing/linked Docker history.
      All eight regressions and 41 focused cases pass. Real pinned Docker probes
      verify second-writer refusal and archive/read/explicit-unarchive/resume;
      all four format recovery controls pass again. Require both probes in CI
      and expand installed-package host/nested backing gates to all three dirs.
      Newest-head CI confirmation and full metadata/index/SQLite/maintenance
      projection remain open.
- [ ] Confirm clean working tree and requirements/evidence consistency; mark ready
      only when implementation and verification are complete. Do not merge.

Current continuation:

- [x] Investigate the independent CodeQL failure behind UNSTABLE even after
      successful workflow runs. Preserve check 121788863524 and alert 228's
      annotation at test-issue-1706-sub-session-size.mjs:34. Reproduce inherited
      synthetic environment values in failure output before removing compared
      values/exception details; preserve named failures and nonzero status.
- [x] Verify fresh CodeQL marks alert 228 fixed without suppression, and inspect
      every newest-head check rather than workflow conclusions alone. Check
      121817770096 passes at 49e4cf280 with zero annotations at 20:07:09 UTC;
      the PR instance is fixed while the unchanged main instance remains open.
- [x] Complete the fresh local default suite: all 723 selected files pass.
      The subsequent complete 724-file run, including the inherited-diagnostic
      regression, also passes at 49e4cf280.
- [x] Preserve the latest checkout timeout and reproduce its false successful
      terminal PR status. Fail cancelled dependencies on every ref; the changed
      integrity test fails before repair and passes afterward.
- [x] Verify the interrupted CI job's rerun and all newly unblocked checks.
      Attempt 2 of run 40376400576 passes, including default/GitHub integration
      suites and packaged Docker verification at c1858ca8f.
- [x] Preserve completed latest-head failures with timestamps and SHA. At
      24c34a39a, packaged Docker passes; default CI stops at a stale mount
      fixture. Repair both incomplete fixtures and extract mount preparation
      to keep the runner below its regression-tested size threshold. All 36
      focused cases and the fresh 723-file local suite pass. The latest CI
      default and GitHub integration suites also pass; Docker remains running.
- [x] Reproduce EACCES/EIO being treated as missing Codex history and a failed
      resume inspection being cached as successful. Three regressions fail
      before repair; all 28 surrounding cases pass after structural refusal.
- [x] Download the actual source-built native CLI from run 40370836766 and
      reproduce auth-required model requests without Authorization after
      canonical logout in both modes and both live clients. Preserve this as
      a separate negative control; do not mistake cache invalidation for refusal.
- [x] Compile and verify the initial exact-source request-admission repair in
      native CI run 40376400046: both modes/peers refuse actual requests after
      malformed/unsafe/logout authority and observe G1 repair/G2 recreation.
      The later provider-override extension still requires rebuilt CI evidence.
- [x] Reproduce eight independent native provider authority overrides using the
      downloaded source-built executable and actual local model requests. Also
      verify stock version/unset identity metadata retains canonical G0.
- [x] Verify the extended request guard refuses all eight provider routes while
      preserving both stock metadata controls in the rebuilt native CLI.
      Run 40384255301 passes all ten cases; alternative constructors and
      agent-identity bootstrap remain separate unfinished work.
- [x] Reproduce actual Bedrock/Mantle and Bedrock Runtime requests that bypass
      ordinary canonical request admission: both use an independent AWS bearer,
      and both send unauthenticated requests with requires_openai_auth=true.
      All four negative controls and four no-selector compatibility controls
      pass against the downloaded actual CLI. The strict refusal assertion
      fails before repair. Pin factory admission ahead of alternate credential
      owners and use an inert rejected provider without remote model discovery.
- [x] Compile the factory repair in the real native CLI and verify zero model
      requests for all four canonical constructor cases while preserving all
      four no-selector controls. The executable from run 40396373397 passes
      all eight locally after cleanup repair. Remaining gateway/agent-identity
      endpoint audit is part of the unfinished all-writer production contract.
- [x] Reproduce named-thread metadata loss after private configuration disposal,
      including with shared native SQLite. Prepare a pinned canonical index
      module; five standalone locking/storage tests pass.
- [x] Compile the native index patch, run native upstream/index tests and verify
      actual name/read/resume after both private configurations are disposed.
      Native CI run 40376400046 passes all 20 selected tests and the real Docker
      metadata/read/resume/peer-update disposal control.
- [x] Compile the exact native rollout maintenance module and reproduce two
      owners for shared rollouts across private configurations. Add a pinned
      canonical maintenance selector; all 12 controls pass against the actual
      patched function, including stable lock identity, owner death, unsafe
      storage, private competing locks and legacy behavior.
- [ ] Verify the maintenance patch in the full native CLI and exercise actual
      concurrent compression/migration output and remaining history writers.
      Run 40384255301 compiles the patch and passes actual named-history disposal
      with its selector; concurrent compression/migration is still unverified.
- [x] Reproduce native TUI split/lost prompt history using exact native modules
      with only passive configuration types stubbed after the full transitive
      build hits its 1 GiB compiler limit. Verify 14 canonical public-API controls
      and all 12 upstream tests in that focused harness: disposal, contention,
      owner death, pagination, atomic publication, stable identity, unsafe storage
      and legacy compatibility. Keep full native integration evidence separate.
- [x] Verify real native prompt-history crate before/after controls, upstream
      tests and full CLI compilation in CI. Run 40384255301 passes all 14 public
      controls and 12 upstream tests. Application-level refusal and remaining
      native writers remain open below.
- [x] Drive the actual native TUI through bounded PTY input and a synthetic
      model endpoint; healthy history/request passes, then strict unsafe-history
      refusal fails. Trace queued model submission preceding async persistence.
      Prepare a five-file pinned compound-event publication patch. Fresh-source
      applicability, rustfmt, 14 focused history controls and 12 upstream tests
      pass; keep full native compilation/execution evidence distinct.
- [x] Verify the current canonical-history CLI reproduces TUI execution after
      refusal, then compile the TUI ordering repair and require actual healthy,
      unsafe and no-selector controls. The actual executable from 40384255301
      reproduces unsafe execution; the executable from 40396373397 compiles the
      repair and passes every actual TUI control after descendant cleanup.
      Other operation/read paths remain part of the unfinished contract.
- [ ] Complete production integration and all previously open six-tool criteria.
- [x] Reproduce actual native Qwen same-timestamp replacement retaining G0 and
      logout retaining G1, including the failing strict assertion. Prepare an
      exact-bundle read repair; all 14 actual-manager controls pass locally with
      bounded synthetic inputs, cleared caches and no network exchanges.
- [x] Verify the pinned Qwen read repair in native CI run 40396374276 at
      c1bfa9c6c. Continue all native writers/backends, actual CLI request refusal
      and production integration; the read-only experiment establishes none.
- [x] Reproduce actual Qwen OAuth client swallowing manager refusal; the strict
      native-client regression fails after the read-only repair. Add pinned
      native OAuth coordination and QWEN_AUTH_HOME selection. Verify all 14
      manager/client read cases, actual kernel wait across private configurations
      and 11 native OAuth writer/failure cases with synthetic fetch responses.
- [x] Verify Qwen coordination in native CI run 40396374276, including the
      actual kernel wait, 14 manager/client controls and 11 writer cases.
- [ ] Verify Qwen actual CLI/model request admission in native CI; audit
      alternative credential backends, all history writers and
      cross-container/upgrade behavior before production integration. Corrupt
      refresh-intent recovery and complete compatibility/migration remain open.

Resource policy: use sequential builds/tests; no real credentials in experiments
or artifacts. Current cgroup usage is mostly reclaimable file cache. Measure
before heavy commands and do not retry an OOM build unchanged.

- [x] Preserve fresh native run 40390941267 and identify the actual compile
      failure in the TUI patch: two anyhow errors must be native color-eyre
      reports. Correct both returns, check exact-source applicability and
      rustfmt, then rerun full compilation and actual TUI/constructor controls.
      Positive execution evidence remains pending until that CI run passes.

- [x] Drive the actual Qwen CLI against a bounded loopback model endpoint.
      Preserve its OAuth sunset refusal; reproduce independent API-key model
      execution despite selected canonical OAuth authority. The strict test
      fails before repair. Pin a native provider factory/use guard, verify
      actual CLI zero-request refusal, five provider modes, six overrides,
      15 retained-handle methods and no-selector native behavior locally.
- [ ] Implement Qwen's current API-key/Coding Plan canonical authority and every
      native writer/backend; OAuth method controls and unsupported-provider
      refusals do not establish a usable canonical CLI auth flow. Verify the
      new actual-request and factory controls in fresh native CI.

- [x] Reproduce native Codex consuming a refresh predecessor again after forced
      owner death during an unknown exchange outcome. Add durable intent and
      recovery evidence before enabling its canonical auth adapter. Keep native
      full-CLI verification separate from standalone storage tests.

## Recovery continuation, 2026-10-30

- [x] Read all current issue/PR comment types; inventory complete requirements.
- [x] Recover the interrupted 46 MB trace, sanitize to a fixed point, retain it
      with a content manifest, and report the suspected classifier false positive
      at https://github.com/openai/codex/issues/58320.
- [x] Merge current main (279ac0560), preserve original history and resolve all
      ten conflicts without dropping either branch's behavior.
- [x] Download and inspect both failing CI runs: patch sharp to 0.35.5; reproduce
      orphaned TUI helper cleanup and verify actual native healthy/refusal and
      no-selector controls after process-group cleanup.
- [x] Reproduce native Codex refresh-owner death consuming G0 again. Preserve
      durable intent. Reproduce malformed-JSON blocking explicit login after
      uncertainty; all seven exact-module transaction tests pass after repair.
- [ ] Verify refreshed Codex full native CLI intent/crash/login controls in CI;
      run 41051640537 passes actual owner-death/login repair, but its later
      model-request fixture fails during default catalog discovery. Correct
      startup routing and verify all retained actual request assertions.
- [x] Reproduce Qwen retrying consumed G0 after metadata-only rewrite. Use the
      refresh-token generation in durable intent, preserve legacy uncertainty,
      and pass all 14 native writer cases plus reads/factory/CLI controls locally.
- [x] Verify the refreshed Qwen controls in native CI run 41051640593 at
      7f4f4c645; inspect downloaded writer, factory and CLI artifacts. All pass.
- [ ] Complete Qwen current API-key/Coding Plan authority, history and production
      integration; passing OAuth method/refusal controls do not establish these.
- [x] Reproduce Router sidecar arguments overriding durable audit declarations;
      restrict extra arguments to resources and inspect actual sidecar storage
      before task-token issuance. All 51 new controls and older lifecycle suites
      pass. Audit contents, conversations and external backend remain open.
- [x] Run all 727 existing default test files in two documented batches, retrying
      the environment-invalidated worker test itself; pass the new Router file
      and both affected lifecycle files after the Router change.
- [ ] Complete every still-open acceptance inventory row; experiments alone do
      not establish packaged six-tool production behavior or lifecycle gates.
- [ ] Wait for required fresh CI, inspect all non-passing logs, update the PR
      with exact evidence and preserve draft status while criteria are unmet.

- [x] Audit native Codex agent identity publication. Reproduce an old identity
      key being written into a replacement account/API-key login when G0 has
      no login_owner_id. Strict actual CLI regression and three focused writer
      tests fail before repair. Require a matching canonical login even for
      legacy credentials; all eleven exact-function focused tests pass afterward.
- [ ] Verify all eight actual CLI identity publication controls after rebuilding
      in native CI. The small harness uses mocked storage/locks; it does not
      replace that full CLI proof or production six-tool integration.

- [x] Add a bounded actual Claude 2.1.310 refresh fixture with a loopback-only
      synthetic provider/proxy and per-child certificate trust. Verify healthy
      G0, expired G1, one exchange/two G1 requests across distinct private configs,
      and paused-response fresh-login/logout ordering. Preserve no-private-copy
      assertions and unconditional native process-group cleanup.
- [x] Reproduce native Claude predecessor reuse after the owner dies between
      provider consumption and publication. Preserve a strict failing regression
      and an explicit negative-control CI step; this is not a repaired guarantee.
- [x] Report the native Claude unknown-outcome gap upstream with immutable
      reproducer, healthy controls and an explicit synthetic-provider boundary
      (anthropics/claude-code 106218).
- [ ] Verify its new pinned-native CI and resolve all-writer crash semantics
      before production integration.

- [x] Download fresh Checks and native Codex failures with timestamps/SHA;
      identify stale dependencies and startup catalog routing, preserving exact
      assertions. Refresh unrelated dependencies and use existing verified-open
      exceptions for the four content-attested native CLI baselines.
- [x] Rerun all 728 default files with refreshed dependencies and required local
      checks. Retry the stale Formal AI fixture at the same failed file.
- [ ] Verify fresh native/image CI; inspect every nonpassing artifact.

Latest CI continuation:

- [x] Preserve completed 7f4f4c645 checks/native logs and verify their SHA/times.
      Security, workflow, links and native Qwen pass. Checks fail dependency
      freshness; native Codex passes builds/TUI/crash but fails request routing.
- [x] Reproduce startup catalog contacting the default endpoint before a
      thread-level loopback override. Keep uncertainty admission unchanged;
      select local startup provider/catalog and refuse all external tunnels.
      Actual downloaded CLI passes both auth modes, provider/constructor
      controls, crash/login repair and TUI; identity retains three before controls.
- [x] Refresh ordinary stale dependencies and use the existing verified-open-issue
      exception policy for exact-version native CLI manifests/adapters.
      Enforcing local freshness passes with zero lockfile lag.
- [x] Finish the refreshed-dependency 728-file suite and local checks: lint,
      formatting, secret scan, changeset validation, file limits, duplication
      (10.06%, limit 12%), actionlint/ShellCheck and enforcing freshness.
- [ ] Push atomic commits and inspect every fresh-head CI result and artifact.
- [ ] Verify the actual repaired native identity writer in a fresh full CLI;
      eleven focused writer cases alone do not establish integration.

- [x] Complete and resume an actual native Claude conversation using a synthetic
      streamed model. Reproduce explicit native missing-session discovery after
      private-history disposal, then require strict resume to fail. Shared
      projects/sessions directories preserve the transcript and prior message
      after both private roots are disposed. This is host native evidence only.
- [x] Preserve the refreshed-dependency suite's stale test at file 543. Update
      the existing Formal AI fixture to 0.355.23 and retry from that same file;
      do not skip the failure or the remainder.

- [x] Report the synthetic native Claude owner-death gap as upstream 106218
      with immutable reproducer and healthy controls; the crash criterion stays
      unfinished pending a safe native implementation/provider contract.
- [x] Verify actual Qwen completion/peer resume after private configuration
      disposal. Private-runtime disposal reaches native missing-session discovery;
      the strict regression fails. Shared runtime retains prior messages and
      transcript with the same session identity. This uses explicit synthetic
      API-key auth, not a canonical current-provider adapter.
- [ ] Verify fresh Qwen history CI and separate runtime workflow executables,
      pinned-context overrides, plans/audit fallback and full lifecycle before
      production projection.

- [x] Verify Qwen completed-history controls in native run 41062245341 at
      2347ebdf5; downloaded positive/private-disposal/strict artifacts all match
      their assertions. Current-provider canonical auth and full lifecycle stay open.
- [x] Download fresh native Codex/Claude failures. Install pinned rustfmt in both
      Codex jobs; limit expected TLS disconnect accounting to Claude's already
      killed first refresh owner. Preserve all predecessor/model assertions.
- [x] Reproduce actual Codex stale identity publication after switching to
      API-key mode with retained OAuth fields. The earlier focused guard fails
      this new case. Require resolved ChatGPT mode; all twelve focused cases pass.
- [ ] Verify all nine repaired actual CLI identity controls in rebuilt native CI,
      and rerun complete Claude CI after its response-disconnect fixture repair.

- [x] Verify the complete Claude experiment in run 41064060494 at 69b1e8a46;
      expected owner-death defect and strict-failure controls remain separate
      from a native fix. Qwen run 41064059810 also passes.
- [x] Confirm actual pinned Claude loads a selected global output-style file
      into a system message. Reproduce nine missed user/managed/link/race audit
      cases before repair, then pass all nine plus 56 related controls. Add
      directory safety snapshots and preserve auth/history/security policy.
- [ ] Finish the new full default suite and inspect fresh native Codex CI;
      investigate the stock ChatGPT negative control at exact failed assertion.
- [x] Reproduce the stock request fixture's G0 result with exact Codex 0.164.0.
      Require cached G0 in both stock modes; keep repaired-client G1/refusal/G2
      requirements unchanged. Both actual stock and repaired controls pass locally.
- [x] Reproduce eight Claude history admission failures before repair. Require
      both configured history mounts, refuse links/files/creation failures and
      create private directories. All nine controls and nineteen dependent
      default files pass; full native history/canonical auth remain open.

- [x] Complete the 729-file local default suite: all pass. Re-run all 19 mount-builder dependents after the Claude history change; all pass, plus nine new reproductions.
- [x] Review completed remote head 69b1e8a46: Checks/release (including packaged Docker), Security, Workflows, links, Claude and Qwen pass. Native Codex full source-built CLI job passes all nine identity cases and TUI/request/crash/history controls; only its separate stock cached-generation fixture fails, repaired locally in 5f1019136.
- [x] Reproduce production stock-verifier orphan helpers on leader exit, malformed IPC and catalog refusal: three failures before group cleanup. After repair, all six (including version success/error/overflow) and 48 existing runtime/catalog/stock/effective-root controls pass; protected authentication is unchanged.
- [ ] Verify the next exact-head CI run after pushing output-style, stock-fixture, Claude-history and stock-verifier cleanup changes. These checks do not establish the unfinished six-tool canonical production contract.

- [x] Preserve fresh 1c183b347 Checks failure 41070646208. Lines 4116–4126
      identify newly published Formal AI 0.355.24 and ESLint 10.14.0 as stale
      dependencies. Refresh image/bootstrap/package/lockfile pins and the
      existing version contract together; keep native version attestations pinned.
- [x] Reproduce six history/data path failures before repair: linked Claude/Codex
      ancestors and parent replacement during all four backends' mkdir. Anchor
      Linux creation to open descriptors and verify public identities afterward.
      All eight controls and 44 related tests pass without changing foreign
      credential/history sentinels. Other-platform and later-mount boundaries
      remain explicit in the evidence.
- [x] Finish the full 732-file local default suite: all selected files pass.
      Re-run all 52 history/path controls after the later directory helper;
      all pass. Full ESLint 10.14 and dependency freshness also pass.
- [x] Verify exact-head native Codex run 41070646110 at 1c183b347: all three
      jobs pass, including stock history and all compiled native controls.
      Checks/release remains failed only at dependency freshness; the updated
      Formal AI/ESLint pins require fresh-head CI.
- [x] Exercise actual cold active/archive compression with two native app
      servers. Reproduce stock ignoring canonical maintenance ownership;
      verify repaired exclusion and peer reads, then reproduce fresh resume
      failing on a deleted private alias retained in shared SQLite.
- [x] Prepare exact-source projection at both native SQLite path writers.
      All nine standalone Rust safety/disposal controls pass. Add strict
      pre-repair reproduction and rebuilt positive/compatibility controls to CI.
- [ ] Verify full compiled compression/path projection, fresh newest-SHA CI,
      remaining full native migration/writers, and production integration.
- [x] Interrupt an actual finite native migration at its pending-journal stage,
      kill and reap the owner, then dispose its private configuration. Reproduce
      the lost recovery journal and all five directory/mount regressions before
      repair. Project one shared journal directory and refuse online movement
      of existing private journals. A peer now completes migration; fresh resume
      still reproduces the separately pending canonical SQLite path defect.
- [x] Reproduce three scoped history parent-link/replacement failures before
      applying descriptor-based preparation. All 83 affected mount, recovery,
      preflight and directory controls pass; full ESLint, formatting, workflow,
      file-limit and secret checks pass.
- [x] Verify native interrupted-migration positive locally with the actual
      rebuilt path-adapter CLI from successful run 41076013002. The same
      canonical journal survives owner disposal, a peer completes migration
      and fresh native resume retains the prior conversation.
- [ ] Finish the complete default suite and verify current-head native CI.
- [x] Download exact-head 67da7a592 CI: native Codex passes all three jobs,
      including compiled compression/canonical metadata/fresh resume. Preserve
      the separate packaged Docker failure at log lines 67230–67243. Reproduce
      the installed-validator missing dependency in an empty task filesystem,
      carry its actual installed helper and preserve failed synthetic diagnostics
      before cleanup. All six focused gate/payload/selection controls pass.
- [x] Repair the missing Formal AI journal fixture after the full 733-file run
      stops there; all 36 affected cases pass. Restart the complete default suite
      (734 selected files); test the later payload regression independently.
- [x] Reproduce real native pending-journal symlink and hard-link truncation
      using synthetic evidence; the strict assertion fails before repair.
      Add exact-source admission before mutation and descriptor-anchored empty
      receipt creation without truncation. All ten standalone Rust controls pass;
      syntax, rustfmt and pinned source applicability pass.
- [ ] Compile the journal-safety adapter in native CI, require both actual link
      refusals and interrupted-migration recovery, and verify packaged Docker
      validator payloads with both daemon layouts after their dependency repair.

- [x] Reproduce exact-head c7a6e20aa CI default-suite failure at file 69/735:
      the new diagnostic upload pushes release.yml to 1,354 lines, exceeding
      the existing 1,350-line warning guard even though the 1,500-line shell
      check passes. Preserve/read job logs and remove duplicate inline base
      diagnostics already validated/reported by docker-pr-build.sh. Retain
      both real image gates and failure-log upload; rerun existing workflow
      and extraction regressions before committing. Fresh CI remains required.

- [x] Finish and reap the complete local 734-file default suite: every selected
      file passes. Verify the newly added 735th payload regression and updated
      packaged-gate cases separately. Existing extraction guard, release-order
      and all six release/image-selection controls pass after the line repair.

- [x] Trace the exact native global instruction/compaction/realtime fields;
      reproduce 48 missing user/profile/managed audit rejections before repair.
      Share one instruction-key policy between user repair and managed refusal.
      All 105 focused audit cases pass, preserving security/runtime settings
      and protected authentication/history identities.
- [x] Verify a real bounded native model request carries an admitted unapproved
      system instruction before repair. The strict control now refuses read-only
      admission, repairs only its registration, restores native instructions on
      the next actual request and preserves credential bytes/inode. Add this
      stock-native control and its diagnostics to CI. Complete surface discovery
      and six-tool production storage remain open.
- [x] Reproduce the indirect native model-catalog instruction authority with
      eight additional audit failures and a real model request using only a
      minimal synthetic model catalog. Refuse its global selector without reading
      or changing the referenced catalog or model/security settings. Require
      repair mode to refuse too; explicit fixture reconciliation restores native
      instructions on a real request and retains provider/auth identity.

- [x] Reproduce native pre-configuration `.env` overriding HOME and discovering
      an unaudited global skill despite a fixed CODEX_HOME. All 17 focused
      refusal/preservation/link/concurrent-addition cases fail before repair.
      Treat this startup input as opaque and report-only, preserve possible
      credentials, and require explicit quarantine. All 96 focused audit cases
      pass; a real native before/after model request verifies discovery removal
      while preserving authentication identity. Add the pinned stock control to CI.

- [x] Verify completed exact-head c7a6e20aa CI: native run 41082125240 passes
      all jobs, including both actual unsafe-journal refusals and interrupted
      migration/fresh resume. Packaged Docker job 124154896652 passes host and
      nested mount/data checks after the payload dependency repair. Preserve
      job logs and structural native evidence; overall Checks remains failed
      at the separate warning guard. Restart local default suite with all 737
      files and continue-on-failure so remaining failures are captured together.

- [x] Reproduce native staging overwrites against the actual journal-guarded
      CLI: plain symlink/hard-link temporary files and compressed migration's
      decompression/output symlinks change unrelated synthetic evidence. The
      strict refusal control fails before repair; healthy compressed interrupted
      migration/disposal/fresh resume passes against the same CLI.
- [x] Extend exact-source migration admission, temporary creation/readers,
      publication and cleanup with descriptor-anchored selected paths. Preserve
      safe orphan recovery without truncating prior inodes. All 13 standalone
      staging and 12 journal controls pass; pinned source applicability passes.
- [x] Reproduce both links overwriting unrelated evidence through the fourth
      temporary form, the child-history boundary rewrite. Healthy plain child
      migration survives interruption, private-scope disposal and peer completion;
      fresh resume honors the retained inherited-prefix boundary.
- [x] Complete all 737 local default test files, with no failures.
- [x] Build the extended native CLI in CI run 41094570272 at 823fb80335; all eight actual staging link
      refusals and plain/compressed/child interrupted-migration recovery controls pass.
      Keep remaining child lifecycle and readers/writers, post-publication crashes,
      power-loss durability and production installation explicitly unfinished.

- [x] Verify exact-head 2ec3b3a7c Checks and release run 41087509851: 737
      default files, both integration files and packaged host/nested Docker checks
      pass. Preserve logs and line-numbered evidence.
- [x] Download failed native run 41087509499 and all artifacts. Its seven passing
      constructor cases are followed by an unhandled ECONNRESET in the local
      CONNECT refusal socket, not an alternate-authority assertion. Reproduce
      three error-handler failures before repair; all four controls pass after.
- [x] Verify compiled native run 41094570272 after the proxy and migration
      staging repairs: all three jobs pass, including all eight constructor
      controls and zero forwarded external tunnels. Checks/release 41094570863
      also passes every job, 738 default files, two integration files and actual
      packaged host/nested Docker backing/data checks.

- [x] Trace Gemini 0.65.0's exact installed native OAuth factory/client. Reproduce
      nine stale request-header cases, including logout/recreation, in the real
      cached factory and retained OAuth client. The strict replacement test fails
      with G0 rather than G1; token verification is a synthetic transport stub.
- [x] Add the pinned opt-in native Gemini read stage with an independent auth
      directory, checked canonical reads, retained-client cache clearing and
      private-copy refusal. All nine read cases, independent-root/disposal and
      three no-exchange writer/expiry refusals pass locally. This stage refuses
      refresh/login/logout; it is not installed or production-ready.
- [x] Verify native Gemini read CI 41094570644 on exact head 823fb80335.
- [x] Complete the full updated 738-file local default suite without failures.
- [x] Reproduce native Gemini loss of a rotated refresh token, cache-publication
      ordering and factory recovery/root-identity regressions. Coordinate inspected
      native refresh/cache/logout entrypoints with durable intent and no HTTP
      refresh retries. All thirteen synthetic native process controls pass locally, including an actual
      native OAuth SDK model request held open while a peer reads G1. Full CLI
      inference remains unverified.
- [x] Extract the existing Qwen transaction engine with provider-specific intent
      names/hash domains. Preserve all fourteen native Qwen manager reads, fourteen
      retained-client reads and fourteen native writer controls after extraction.
- [x] Verify Gemini writer CI 41099170547 and shared-engine Qwen CI 41099170515
      at 427f336085; both pass their then-current controls.
- [ ] Verify the expanded login/revocation CI checks; implement account metadata, other provider
      factories/retained-legacy handles, actual requests, history, lifecycle,
      production integration and every remaining criterion.

- [x] Download exact-head 427f336085 Checks run 41099170779 after the early
      dependency freshness failure. Lines 3819–3827 identify eight stale Formal
      AI declarations after release 0.355.25. Verify the upstream release tag,
      update all four Docker ARGs and preserve CLI authority pins. The five
      existing freshness/image test files pass (21 reported tests).
- [x] Verify authenticated freshness after the pin update: zero stale or
      unresolved dependencies. The 21 existing freshness/image tests pass.
- [ ] Require the packaged image CI gates again; an early dependency failure verifies none
      of those downstream gates. Native Gemini writer CI 41099170547 passes
      all thirteen process scenarios; Qwen CI 41099170515 also passes.
- [x] Reproduce authorization-code refusal after healthy native G0 admission.
      Add compare-and-publish for complete new-login generations; preserve a
      concurrent external G2 and existing credentials after network refusal.
      All three actual native authorization-code controls pass locally.
- [x] Reproduce selected native revocation refusal after replacing G0 with G2.
- [x] Coordinate native revocation against the current generation, durably remove
      local authority before sending the request, disable revocation retries,
      reject an explicit stale token and verify success/network failure.
- [x] Complete initial interactive login through native manual-code and browser
      callback flows; fresh peers read the durably published generation. Refuse
      malformed existing authority before browser launch or exchange. All 26
      native writer/login/revocation controls pass, together with 11 canonical
      reader/private-scope controls and nine unchanged legacy reproductions.
      All 42 Qwen regressions still pass after the shared-engine extension.
- [x] Reproduce private native account-cache publication and omitted cached-login
      callbacks. Add canonical account storage, native synchronous/asynchronous
      readers, path reporting, generation-bound user-info publication, account
      counts, refresh metadata and logout. The first 39 expanded writer controls
      pass, with 11 canonical readers and nine preserved legacy reproductions.
- [x] Reproduce same-process login refusal after native logout; clear the cached
      factory on selected logout/revocation and exercise native code login again.
- [x] Verify all 41 account/path/scope-disposal controls locally, plus 11 canonical
      reads and nine preserved legacy reproductions.
- [ ] Verify the expanded account/login/revocation stage in CI.
      Continue every remaining matrix criterion; these
      experiments are not installed by production launchers or images.
- [x] Reproduce alternate native Gemini config/client constructors bypassing the
      selected OAuth authority, including retained Code Assist handles after
      endpoint/header edits. Add exact-source admission before private key/ADC
      fallback and native request dispatch, preserving unselected behavior.
- [x] Verify the new constructor/request controls and retain all 41 native writer,
      11 canonical-read and nine legacy-read controls; keep full CLI/history and
      production integration explicitly unfinished until implemented and verified.

- [x] Verify 30 selected native config/constructor/request controls and 30
      unselected compatibility controls locally. Preserve the existing logout
      and source-change refusals and observe G1 after canonical replacement.
- [x] Investigate exact-head Gemini CI 41104225569. Its new callback assertion
      masked the original-package rotation mismatch; scope that assertion to
      the coordinated stage, reproduce the intended mismatch again and check
      all five pre-coordination login/account/revocation regressions locally.
- [ ] Exercise the actual Gemini CLI with a loopback-only TLS provider fixture,
      then implement/verify canonical full conversation discovery and resume.
- [x] Complete a real native Gemini CLI OAuth inference through a TLS-verifying,
      non-forwarding local provider. Require canonical credentials/account data
      and absence of private credential/account files.
- [x] Reproduce full CLI history loss after private-home disposal. Require a
      successful native request and transcript first; the strict regression
      then fails at fresh-peer conversation discovery with no second request.
- [x] Download exact-head Checks 41104225711 test-job diagnostics and reproduce
      the bootstrap/image version mismatch with the existing matrix test.
      Align the bootstrap constant with all four 0.355.25 image pins; all
      30 matrix/freshness/image checks pass. Preserve compatibility minimums.
- [x] Complete all 738 default test files locally after the bootstrap repair.
- [ ] Require
      fresh exact-head test and packaged image CI. Preserve the running native
      Codex build before pushing the next atomic commits.
- [x] Reproduce the remaining stale dependency-pin assertion in the full local
      suite (file 553/738). Align its expected Formal AI release with the already
      verified image/bootstrap pins; the focused assertion passes. Restart the
      full suite with continue-on-failure to collect all remaining failures.
- [x] Implement an exact-pinned Gemini conversation selector, canonical project
      mapping and coordinated bounded transcript/summary readers and writers.
      The full native CLI discovers and resumes prior user/model content after
      private-home disposal; symlink and hardlink attacks preserve outside bytes.
- [x] Verify eleven isolated storage refusals/healthy controls, four independent
      writers preserving all 40 records and a stale rewrite preserving all 50
      records after a peer append, with an unchanged lock inode.
- [ ] Verify the new native history stage on Node 24 in CI. Complete other
      history surfaces, cleanup/import writers, child lifecycle/crash recovery,
      alternate backends and production integration; these are still open.
- [x] Preserve all 41 native writer/account, 30 request and 11 canonical read
      controls after adding conversation storage, locally.
- [x] Reproduce native malformed/truncated transcript acceptance. A first read
      refusal still lets automatic retention unlink the rejected transcript;
      reproduce that separate data-loss path before guarding the cleanup catch.
- [x] Validate bounded JSON/JSONL records before reads/writes and recheck failed
      history authority in native listing/cleanup. All 19 storage controls and
      four full CLI unsafe-history controls pass, preserving canonical and
      protected-file bytes/inodes with no additional inference.

- [x] Reproduce syntactically valid native records losing project metadata or
      naming another project. Admit only a complete native parsed conversation
      with a session UUID, the selected project hash and a message array. All
      seven full CLI unsafe-history controls and healthy discovery/resume pass.
- [x] Preserve no-selector behavior, all 41 native writer/account controls,
      30 request controls, 11 canonical reads and 19 storage controls after
      parsed-record admission, locally.
- [x] Verify the preceding conversation stage on Node 24 in Gemini CI
      41111156696, including actual native discovery/resume, four unsafe-history
      refusals, 19 storage controls and the authentication regressions.
- [x] Investigate exact-head Checks 41111156810: Prettier rejects the expanded
      manager-hash assertion in the writer probe. Reproduce that formatting
      failure locally and format the assertion; preserve the complete CI log.
- [x] Pass full formatting and lint after repairing the expanded assertion.
- [x] Commit parsed-record admission and the formatting repair as `e4413192c`.
- [ ] Require fresh exact-head CI without interrupting the in-progress compiled
      Codex build.
- [ ] Reproduce valid but non-resumable/subagent canonical records being treated
      as disposable by native retention; coordinate retention/deletion writers
      without losing canonical data or bypassing the native retention feature.
- [x] Reproduce actual native retention deleting valid startup-only and expired
      canonical records; also reproduce explicit deletion operating on the old
      private chats directory. Preserve records with coordinated archive rename
      and directory synchronization, keeping the native active listing behavior.
- [x] Reproduce peer retention archiving a live model writer. Add per-conversation
      kernel leases to actual native writer initialization; skip a busy record
      during retention and refuse explicit deletion while it is owned.
- [x] Pass actual CLI empty/expired retention, explicit deletion and two live-peer
      controls locally. Pass 29 bounded storage controls, including stale archive,
      linked/archive-directory attacks, changed lease files, independent writers
      and recovery after owner death. Preserve bytes and stable lock identities.
- [ ] Verify the expanded retention stage and native auth regressions in CI;
      complete archive discovery/resume, imports, subagent/artifact lifecycles,
      all other history surfaces and production installation.
- [x] Verify native retirement and all authentication regressions on Node 24
      in CI 41116035148 at `4a6be5dfb`. All seven unsafe-history controls,
      five retirement controls and 29 storage controls pass.
- [x] Reproduce native archive discovery/resume failures after successful
      inference, explicit deletion and private-home disposal. Add bounded native
      archive enumeration, `--list-archived-sessions` and exact-UUID resume.
      Preserve archive bytes/inodes while publishing a separate active record.
- [x] Reproduce a concurrent new file being appended to and a restore publication
      overwriting a newly created active file. Use exclusive creation and
      non-replacing publication; both bounded race regressions pass after repair.
- [x] Pass 41 bounded storage controls, seven actual archived-record refusals,
      actual archive discovery/resume and concurrent native resume exclusion.
      Discovery performs no inference and does not reactivate a retired record.
- [ ] Verify archive discovery/resume and its expanded controls in CI; complete
      import, artifact/subagent lifecycle, all remaining history surfaces, crash
      recovery and production integration.
- [x] Verify a second native deletion/private-home disposal and archive resume:
      all generations remain discoverable, including startup-only records; the
      third inference contains both preceding prompts and the prior response.
      Every archived generation retains its bytes and inode.
- [x] Reproduce UUID-only canonical validation rejecting a session identifier
      accepted by the actual native CLI. Preserve its alphanumeric/dash/underscore
      alphabet in parsed-record admission and archive lookup; verify complete
      opaque-ID discovery/deletion/archive/resume after private-home disposal.
- [ ] Verify the native-ID compatibility change, malformed-ID refusal and all
      storage controls in CI, then complete the explicit native import path.
- [x] Reproduce native `--session-file` refusal after healthy canonical inference.
      Add checked explicit-source reads and native parser admission, retain the
      source generation/identity through parsing, and publish through canonical
      writer ownership with exclusive private creation.
- [x] Pass full native import/disposal/discovery/resume for canonical records,
      foreign-project private JSONL exports and legacy JSON exports. Preserve
      source bytes/inodes; each third inference includes all preceding prompts
      and model content. Nine unsafe-import CLI controls and 45 bounded storage
      controls pass, including changed/replaced source/parent during parsing.
- [x] Rerun final native authentication/archive controls after import admission:
      all 41 writer/account, 30 request and 11 read controls pass. The stricter
      nine import refusals, seven archive refusals and live archive peer require
      no additional model request, preserving all canonical/audit generations.
- [ ] Verify fresh Node 24 import/archive/native-ID CI, then complete every
      remaining history surface, lifecycle, backend and production criterion.
- [ ] Investigate Checks 41116035200 Docker cancellation at the exact pushed
      head. Preserve the full log, identify export-time resource pressure,
      reproduce a focused control before any change, and require a fresh
      successful packaged-image run without extending its timeout.

- [x] Preserve exact-head Docker timeout evidence with full-log line numbers.
      Both image instruction sequences finish; export grows dockerd to 13 GiB
      RSS and almost 10 GiB swap. A focused build-script control fails before
      configuring the actual daemon and passes after a CI-only soft Go memory
      policy. Keep the 30-minute deadline and require real export verification.
- [ ] Verify the proposed Docker export memory policy in fresh packaged-image
      CI. Do not equate mocked setup controls with reduced real export memory.
- [x] Reproduce invalid UTF-8 being accepted through active history reads,
      explicit imports and read-before-archive. Validate bytes before decoding;
      all 49 bounded storage controls pass, including valid multilingual text
      and a literal replacement character. Refusals preserve bytes and inodes.
- [ ] Verify strict decoding in native CI and preserve complete offloaded tool
      output through private-home disposal and fresh native resume/read.

- [x] Verify the complete import/archive/native-ID stage on Node 24 in Gemini
      CI 41121912110 at `946ed6e82e07426dbe6ebd224c7675796dcbe339`.
      Preserve its full log and downloaded native diagnostics. All 41 writer,
      30 request and 11 read controls pass there.
- [x] Reproduce full native offloaded-tool-output loss only after successful
      shell execution and inference. Publish immutable canonical artifacts
      through the native truncation and both masking implementations; admit
      registered-project reads through checked snapshots and content digests.
- [x] Verify actual fresh-home resume/read_file sends the complete old output
      to the provider without changing its bytes/inode. Eight unsafe-artifact
      CLI controls refuse before any further inference; 65 bounded storage
      controls and nine actual native writer/legacy controls pass locally.
      Preserve native long-line formatting and ordinary text reads.
- [x] Rerun all 41 writer/account, 30 request and 11 read controls on the final
      artifact manager; all pass. The complete 739-file default suite passes.
- [ ] Require fresh Node 24 strict-decoding/artifact CI. Complete degraded blobs,
      other history writers, subagent lifecycle, interrupted publication, all
      backends and production integration; full six-tool acceptance stays open.

- [x] Verify the Docker resource repair in actual packaged-image CI 41121912167
      at `946ed6e82`: both exports finish (195.1/231.5 seconds), both installed
      images and nested daemon restart/snapshot checks pass within the unchanged
      deadline. Preserve full-log line numbers and sampled RSS/swap caveats.
- [x] Preserve successful compiled Codex CI 41121912107 and its native build,
      process and experimental CLI artifacts before advancing the branch.
- [x] Reproduce a successfully written/read native PNG disappearing on private
      home disposal. Add checked immutable binary publication, bounded base64
      decoding, MIME retention and native image read admission.
- [x] Verify every new blob refusal/compatibility control and preceding native
      storage/authentication/full-CLI regressions locally. Require fresh Node 24 CI.
- [x] Pass all 22 actual native blob controls, including fresh-process reads
      after disposal for ordinary/uppercase MIME and unpadded base64. Preserve
      competing publication and protected data in every refusal control.
- [x] Pass 65 storage controls, all nine truncation/masking/legacy controls,
      complete CLI tool-output resume and all eight unsafe-artifact CLI controls
      on the final blob manager. All 41 writer/account, 30 request and 11
      canonical-read authentication regressions pass on this manager too.
- [ ] Require fresh Node 24 strict-decoding/artifact/blob CI. Blob export-only
      controls do not establish complete CLI degraded-blob transport; retain
      all remaining six-tool history, lifecycle and production requirements.
- [x] Exercise degraded blobs through complete CLI context management and fresh
      resume/read_file against the synthetic loopback provider. First require
      healthy native image execution and inference, then the specific lifetime
      failure before repair. Check the new read_file response contains the PNG;
      an image retained in earlier transcript content cannot satisfy it.
- [ ] Coordinate remaining native Gemini Logger logs.json and named-checkpoint
      reads/writes/deletion, interactive shell_history, Git checkpoint backing,
      plans/tracker/task state and child/subagent lifecycles. Native Logger
      currently caches reads, rewrites the full log without a cross-process
      transaction and swallows write errors; sharing its raw directory is not
      sufficient. Keep executable/configuration material private.

- [x] Reproduce JSON/text blob compatibility loss and padding-only base64
      acceptance before repair. Preserve native checked-buffer classification,
      BOM decoding and formatting; all 31 bounded native controls pass, including
      seven fresh-process JSON/SVG/UTF-16/audio-text/image reads.
- [x] Verify complete CLI degradation/disposal/resume/read_file against the
      TLS-verifying loopback provider. The workspace image is removed, and the
      new tool response must contain the original PNG rather than relying on
      old transcript image data. Bytes, device and inode remain unchanged.
- [x] Pass all seven full CLI unsafe-blob controls before any further model
      request, preserving protected bytes/device/inode/size.
- [x] Rerun preceding native auth / storage / tool-output regressions on the
      exact final manager/helper: all 65 storage, nine native writer/legacy,
      complete tool-output CLI positive and eight refusal controls, plus
      41 writer/account, 30 request and 11 canonical-read controls pass.
- [x] Tighten the complete CLI PNG assertion to require the exact new function
      response and its embedded or immediately following image. Reject earlier
      and unrelated later images in finite assertion controls; rerun the full
      native PNG disposal/resume/read_file control successfully.
- [x] Verify strict decoding, complete tool-output and degraded-blob controls on
      Node 24 in run 41132983002 at d0b4f6b47. Download all 433 native diagnostic
      files and preserve the complete log; every native Gemini stage passes.
- [x] Preserve a local suite invocation failure at the existing capped-worker
      test: the global NODE_OPTIONS heap override defeats its intended worker
      resource limit. The focused rerun without the override passes all 40
      assertions. Keep the original failure log.
- [x] Run default files 562 through 739 without the global override; all 178
      pass. Together with the initial 561 passing files, all 739 default files
      pass across the two invocations. Preserve the original failure and resumed
      run separately. Full formatting, ESLint and focused secret scanning pass.

- [x] Preserve exact-head Checks 41132983086 failure after the new Formal AI
      release: full log lines 3816–3824 report eight stale declarations of
      0.355.25 versus 0.355.26. Update the four Docker build arguments together.
- [x] Rerun dependency freshness locally: all tracked declarations are current,
      with zero stale/unresolved/lagging lockfile records. All 35 focused
      freshness/image/release-order controls pass.
- [ ] Require fresh full packaged-image CI after the Formal AI update; the
      failed detect-changes stage skips all test/image verification.
- [x] Reproduce native Gemini Logger prompt-history/checkpoint loss after a
      healthy native write and private-home disposal, plus stale cached peer reads.
      Coordinate fresh reads and concurrent writers, preserve old checkpoint
      generations and refuse unsafe storage without swallowing errors. All 30
      scenarios / 36 bounded native process results pass on the final helper.
      Reproduce replacement during staging flush, then refuse publication while
      preserving both the prior file and the replacement. Keep UI/lifecycle open.
- [x] Pass all surrounding regressions on the final Logger manager/helper:
      65 storage, nine native tool-output writer/legacy, 31 blob, both complete
      CLI artifact/blob disposal/resume positives and 41/30/11 auth controls.
      Full formatting, ESLint, focused secret scanning, actionlint and syntax
      checks pass. Repeat all full CLI refusals in fresh Node 24 CI.
- [x] Require fresh Node 24 native Logger CI after all local checks pass.
      Run 41137763744 passes at 8f2ec5c8e; preserve its log and 586 artifacts.
- [x] Reproduce interrupted first publication in all five selected families;
      fresh readers reject complete two-link data after the owner is killed and
      reaped. Preserve the exact preceding helper as a checked disposable control.
- [x] Add synchronized, bounded publication journals and checked recovery under
      the stable lock. All fifteen before-link/after-link/after-unlink recovery
      controls pass, retaining original bytes/device/inode after private disposal.
- [x] Reproduce live journal replacement being deleted by the draft, then
      require publication refusal while retaining staged, protected and peer data.
- [x] Pass all twenty unsafe-evidence refusals and verify fresh source application
      yields the exact tested manager/CLI/helper files. A fresh native registry
      crash/read control passes on that newly applied package too.
- [x] Run full formatting, ESLint, focused secret scanning, actionlint and syntax
      checks on the recovery stage. Preserve the preceding negative controls,
      failed draft and final protected-data evidence.
- [x] Pass all surrounding native regressions on the final recovery helper:
      36 Logger, 65 storage, nine tool-output and 31 blob controls, both full
      CLI disposal/resume positives, all eight artifact and seven blob CLI
      refusals, and 41 writer/account, 30 request and 11 canonical-read controls.
- [x] Require fresh exact-head Node 24 CI. Run 41137763744 passes at 8f2ec5c8e.
      Retain incomplete/invalid intent and remaining
      append/UI/power-loss/full-history/production criteria as unfinished.

- [x] Reproduce actual interactive shell-history loss after a healthy native
      hook write/read and private-home disposal, using export-only access and
      a finite React state/effect dispatcher. Preserve the failed fresh-peer
      assertion; this does not claim full TUI admission.
- [x] Reproduce cached navigation and swallowed persistence failures before
      repairing the inspected native hook. Retain native navigation limits,
      preserve a complete command audit and coordinate fresh cross-process writes.
- [x] Verify shell-history disposal, peer navigation, four writers, write refusal,
      audit retention and legacy behavior; require the complete surrounding
      native regressions and fresh Node 24 CI before claiming this stage verified.
- [x] Pass all 22 hook scenarios / 28 bounded native process results on the
      final fresh-applied package, including four writers preserving 40 commands,
      all 122 audit events behind a 100-command view and eleven unsafe-storage/
      schema refusals. The unselected native file behavior remains available.
- [x] Use the complete uninstrumented native TUI through a bounded PTY and
      TLS-verifying synthetic provider. Reproduce command recall loss only after
      a healthy command creates its witness, private-home disposal and a healthy
      fresh TUI inference. The repaired fresh TUI recalls and executes it.
- [x] Locally verify full TUI admission for seven unsafe command-audit cases and
      preserve protected evidence. Add strict before and after controls to CI;
      fresh-head Node 24 execution remains required above.
- [x] Reproduce invalid command data being accepted during navigation and direct
      submission, then validate inside the locked append before publication.
      Reproduce the actual TUI dispatching before its asynchronous loading error;
      perform checked command admission before rendering and inference.
- [x] Rebuild all five history stages from the pinned constructor package;
      applicability checks change no bytes, all eight resulting files match,
      and the fresh native hook lifetime control passes.
- [x] Pass surrounding native controls on the final shell-history helper:
      36 Logger, 65 storage, nine tool-output, 31 blob and 36 publication results;
      complete artifact/blob CLI disposal/resume, all eight artifact/seven blob
      CLI refusals, and 41 writer/account, 30 request and 11 canonical-read checks.
- [x] Pass complete repository formatting and ESLint, focused secret scanning,
      actionlint and syntax checks before committing the shell-history stage.
- [x] Download the fresh default-suite failure from job 124345404794, run
      41137763864 at 8f2ec5c8e. Reproduce its Formal AI runtime/image mismatch
      and the dependency-pin fixture mismatch locally. Align both with .26;
      all twelve focused checks, formatting and ESLint pass before committing.
- [x] Preserve complete Checks 41137763864 logs. Packaged host/nested mount and
      directory projections pass at full-log lines 44933-44940. The only failed
      job is the reproduced runtime/image mismatch at line 46238; Pipeline Status
      propagates that failure. Native Codex 41137763884 passes all three compiled
      jobs at the same head; preserve its complete logs and native artifacts.
- [x] Run all 739 default test files after the Formal AI pin consistency fix;
      one complete invocation passes without a global heap override. No OOM kill
      occurs. Preserve new CI logs and verify fresh timestamps and head SHA.
- [x] Pass fresh Node 24 shell-history CI 41143418875 at 39e2e0d75, created
      2026-10-30T23:16:01Z. Preserve the complete 938-line log and 658 diagnostic
      files. Checks/release 41143419018 also passes all default/integration files
      and both packaged host/nested Docker projection checks at the same head.
- [x] Reproduce native tracker task loss after healthy creation/update/read and
      complete private-home disposal. Keep the actual native service/schema and
      preserve failed fixtures; bound every process and diagnostic file.
- [x] Preserve tracker generations through checked canonical transactions,
      independent writers, native session separation and unsafe-storage refusals.
      Verify native dependency/parent behavior and default unselected compatibility.
      Keep complete CLI admission and all other unfinished storage criteria open.

- [x] Reproduce actual complete CLI tracker loss after healthy create/update/get/
      list, private-home disposal and a new native list call during resume.
      Canonical tracker storage passes the same complete CLI lifecycle locally.
- [x] Reproduce malformed tracker data reaching inference in the storage draft;
      checked native configuration startup admission now precedes dispatch.
- [x] Reproduce a peer reopening a dependency after closure validation and a
      peer changing an edge after cycle validation. Bind actual native validation
      reads to their locked append using an async operation context; both focused
      refusal controls pass without changing committed peer data.
- [x] Locally verify all 32 tracker scenarios / 40 bounded native process results,
      seven complete CLI startup refusals and the full surrounding native
      regressions on a fresh byte-identical source application. Preserve strict
      before controls and failed drafts separately from passing after controls.
- [x] Pass complete formatting and ESLint, both helper ESLint checks, focused
      secret scanning, actionlint, Python AST and Node syntax checks before
      committing the tracker stage. Preserve all bounded diagnostics locally.
- [x] Verify Node 24 tracker job 124374272320 at 3aff67264d in run
      41146984829 and preserve all 324 artifact files: 40 native process results,
      complete CLI lifetime/seven startup refusals, fresh-source reconstruction
      and surrounding regressions pass. The sibling job timeout remains separate.
- [x] Preserve Gemini 41146984829's 1435-line log and exact-head annotations:
      the tracker job passes; the original history job exceeds its 15-minute
      total during the final authentication controls. Compare independent step
      durations with the preceding passing run. Split the final 13 checks into
      an independent reconstruction job, preserving all 73 named checks and
      existing job bounds. Run actionlint and formatting before committing.
- [x] Require fresh CI for the partition and interrupted authentication checks:
      all four Gemini jobs pass at 40db3a6e3c0 in run 41150101913.
- [ ] Preserve native Git checkpoint objects and every acknowledged head across
      private-home disposal without sharing Git configuration or hooks. First
      reproduce lifetime loss, private executable filters and missing older
      commits. Verify actual native Git peers, concurrent writers, audit history,
      project separation and unsafe-object refusals. Add complete CLI startup
      controls and a fresh-source reconstruction before enabling this adapter.
      Native terminal restorable-tool metadata, legacy migration, interrupted
      object publication and production integration remain separately unfinished.

- [x] Pass the native Git object's 21 scenarios / 25 process results and all
      seven complete CLI startup refusals locally. Verify head continuity across
      complete CLI disposal/resume and compare fourteen fresh-source files.
      Keep the actual terminal/ACP metadata and production criteria open.
- [x] Pass final-Git surrounding native tracker, shell, Logger, storage, artifact,
      blob, publication and authentication suites, plus full CLI tool-output/blob/
      tracker disposal/resume and real terminal shell recall. Pass full repository
      formatting/ESLint, focused helper lint, secret scan and workflow checks.
- [x] Require exact-head Node 24 Git CI and the independent history-job partition
      at 40db3a6e3c0. Preserve the complete 2373-line Gemini log and 1329 artifact
      files; all four jobs pass, including the full credential job.
- [x] Observe successful Git, tracker and independent history-regression jobs at
      40db3a6e3c0 in run 41150101913. Credential reads subsequently pass too;
      the complete workflow succeeds at 2026-10-31T00:35:39Z.
- [x] Trace the actual terminal's missing checkpoint to a second native GitService
      over startup's initialized private repository. Reproduce that refusal in a
      focused native service control, then reuse the checked repository seal.
- [x] Verify all 24 Git scenarios / 28 native process results and fourteen fresh
      source files after service reuse. Full formatting/ESLint, actionlint,
      secret scanning and Python parsing pass before commit c055c7dd2;
      that stage does not persist native terminal restore metadata.
- [x] Reproduce actual terminal restore metadata loss after a healthy
      acknowledged edit and complete private-home disposal. Preserve the actual
      pre-edit commit, UI conversation, model history, tool and prompt identifier
      as data-only generations in checked canonical prompt history.
- [x] Pass 26 native metadata scenarios / 30 native process results: independent
      writers, retained readers, replacement generations, project separation,
      restore ordering and 17 unsafe metadata controls. Preserve native automatic
      tool replay and use an untouched companion file to prove the Git restore.
- [x] Reproduce an approved native edit executing with damaged restore metadata.
      Bind the actual terminal writer before native approval and execution;
      validate registered metadata before provider dispatch, and reject failed
      snapshots instead of falling back to an older head. Healthy restore,
      live refusal and fresh startup refusal pass with the guard applied.
- [x] Rebuild fourteen history stages from the pinned constructor package and
      compare all seventeen manager, CLI and helper files byte for byte without
      applicability-check mutations.
- [x] Complete final-source Git, tracker, shell, Logger, artifact, blob, storage
      and first-publication recovery suites; commit the metadata and edit guard.
- [x] Pass all 41 authentication writer/account, 30 request and 11 canonical-read
      controls on the final reconstructed native package. Reap every process.
- [ ] Publish the verified commits and require exact-head Node 24 restore and
      surrounding regression CI.
- [x] Preserve all eight successful workflows at preceding commit 40db3a6e3c0,
      including complete Checks and Codex logs and exact test/Docker line numbers.
      Reproduce the final-source shell probe rejecting its new terminal hash
      before execution; add that exact tested hash and rerun the complete suite.
- [ ] Complete every native ACP checkpoint writer, child/subagent writers, all plan
      and task memory, legacy migration, interrupted/power-loss publication and
      production package/image/launcher integration. Native terminal evidence
      does not complete these criteria or the all-six-backend acceptance matrix.
- [x] Trace actual ACP session tool execution and require a strict healthy-edit
      regression before implementing its missing checkpoint writer. Exercise the
      actual JSON-RPC CLI, private-home disposal, fresh native session load and
      restore; keep terminal and ACP model-history behavior separately verified.
- [x] Reproduce the actual ACP edit completing without an acknowledged checkpoint.
      Await its native snapshot/metadata writer before approval, and revalidate
      before actual execution. Preserve unselected private behavior.
- [x] Reproduce native ACP restore changing files while retaining later messages
      in the next actual provider request. Apply restored history through the
      actual chat and its existing durable recorder after checked Git restore.
- [x] Reproduce the original prompt disappearing on a third native ACP reopen:
      native checkpoint history coalesces it with the filtered session context.
      Preserve actual turn boundaries before native checkpoint serialization.
- [x] Reproduce actual restore listings showing Unknown for a saved checkpoint.
      Read the validated canonical filename and native tool instead of fields
      absent from the native checkpoint information. Verify both restore commands
      without inference or project changes.
- [x] Verify actual native replace, automatic edit mode and cancellation.
      Automatic edits require the same checkpoint without a permission request;
      cancellation leaves both project files unchanged and retains its checkpoint.
- [x] Verify the full three-process ACP restore, complete prior audit retention,
      live/startup unsafe metadata refusals and unselected native behavior.
      Distinguish the real conversation audit from temporary empty sessions that
      native cleanup may archive. Rebuild all eighteen stages without mutation
      during applicability checks, and compare all seventeen final native files.
- [x] Add a bounded independent ACP CI job preserving all four strict before
      controls. Run the combined reconstructed package through all 54 metadata
      assertions, three terminal controls and all 82 authentication controls.
- [x] Commit atomic ACP changes and push only the prepared branch. All six Node
      24 Gemini jobs pass at b44086a4cd2d in run 41156793225; download and inspect
      all 123 ACP artifacts, including four strict before failures, eighteen
      reconstructed stages, 54 metadata assertions and 82 auth controls.
- [x] Extend actual terminal restore verification through a third private-home
      disposal/resume and inspect its next model history and retained audit.
      Reproduce its coalescing checkpoint getter dropping the original prompt;
      preserve actual context/user turns before native serialization. Verify
      actual interactive input after resume; keep its automatic startup-prompt
      race as a separate reproducing test and source repair.
- [x] Preserve terminal reopen evidence and rerun surrounding native shell and
      ACP/refusal controls on the fresh combined package.
- [x] Commit the atomic terminal checkpoint repair as be4609d3d2f4.
- [x] Reproduce the actual terminal automatic startup-prompt/resume race after
      healthy native restore. Its final real request omits the original history.
      Add an initially closed selected-history admission barrier and open it only
      after actual resumeChat resolves. Verify the same strict automatic control
      and a fresh twenty-stage reconstruction; preserve manual terminal, ACP and
      live/startup refusal behavior.
- [x] Commit terminal resume admission as 62bc78758 after local checks. Preserve
      all preceding compiled Codex results before replacing branch workflows.
- [x] Push the terminal stages; all six Gemini jobs pass at exact head
      533cc3a20c01 in run 41160834587, including both terminal strict before
      controls and reconstructed-source manual/automatic resume.
- [ ] Exercise failed/interrupted native resume admission and finish remaining
      native writers, complete lifecycle and production integration criteria.
- [x] Trace headless native edits separately from terminal and ACP execution.
      Both the legacy and native agent-session engines first complete actual
      write_file/inference, then fail the strict canonical checkpoint assertion.
      Register both native schedulers with the checked pre-edit writer.
- [x] Verify actual headless edit, fresh ACP restore and third headless resume
      through two complete private-home disposals in both native engines. Require
      restored original model history, unchanged prior audit and actual Git undo.
- [x] Verify both headless engines' startup and live metadata-damage refusals and
      unselected private recording/editing. Live damage occurs during a real
      resumed model request after a healthy edit; the returned second edit and
      further inference refuse while protected project/audit bytes are retained.
      Reconstruct all twenty-one stages without applicability mutation and retain
      all seventeen identical native files. The fresh package also preserves the
      actual automatic terminal prompt/resume control.
- [x] Commit the headless writer stage as 3a4756af2 after local checks.
- [x] Publish the headless stage: both strict before failures, after/fresh-source
      cycles and live/startup refusal/private controls pass in Node 24 CI
      41160834587 at 533cc3a20c01.
- [x] Verify actual failed terminal resume under a live native writer: no
      automatic or typed inference, unchanged project/metadata/audit, and healthy
      recovery after the owner process group is stopped and reaped. The preceding
      nineteen-stage package also refuses this ownership conflict; this extends
      lifecycle coverage, without claiming a new source repair. The repaired
      twenty-one-stage package keeps actual typed prompts disabled after refusal.
- [x] Publish the live-owner refusal regression; all five assertions pass in
      Node 24 CI 41160834587. The added startup/discovery interruption controls
      follow that SHA; asynchronous resume and physical power loss remain open.
- [x] Preserve all eight successful workflows at b44086a4cd2d, including full
      Checks/Codex logs, downloaded compiled native build artifacts and exact
      test, provider, owner-death and packaged Docker evidence. These results
      precede the later terminal, headless and child source repairs.
- [x] Reproduce canonical child recording refusal after a healthy actual private
      root invoke_agent/generalist child edit/complete_task/root continuation.
      Trace default recursive mkdir creating 0755 parent-session directories;
      route creation through checked 0700 allocation and register the anchor.
- [x] Verify complete canonical root/child transcripts, private-home deletion,
      fresh native discovery/summary and root resume retaining the actual child
      result and preceding audit. Unsafe mode, symlink and parent replacement
      refuse before child inference/edits while preserving protected evidence.
      Reconstruct twenty-two stages without applicability mutation and compare
      all seventeen native files byte for byte.
- [x] Finish surrounding regressions on the fresh child package: shell 28,
      metadata 54, authentication 41/30/11, terminal 4, ACP 3, both headless
      engines 4 each, live-owner refusal/recovery 5 and terminal live/startup
      refusal 1/2 assertions all pass.
- [ ] Commit/push the child repair and require all exact-head CI checks.
- [ ] Complete child checkpoints/restores, concurrent children, remaining agent
      definitions, task/plan memory and production lifecycle/installations;
      healthy child recording is insufficient.

- [x] Exercise actual delayed/interrupted history admission with the existing
      canonical kernel lock: prove the native child waits on that exact inode,
      then release it or kill/reap the waiting terminal and recover. Distinguish
      this startup/discovery boundary from interrupted asynchronous resumeChat,
      checkpoint publication and physical power-loss paths, which remain open.

- [ ] Publish the delayed/interrupted lock admission controls after focused
      checks; require their strict native before and both fresh-source controls
      in new exact-head Node 24 CI. Preserve the current compiled CI first.

- [x] Reproduce retained native conversation evidence loss before repair: strict
      helper append/read rollback and same-byte file replacement fail; actual
      native inference completes after losing its real tool call/result. Retain
      inode/complete-prefix evidence and require actual native refusal instead.
      All 69 storage assertions pass; a real discovery peer appends its summary
      while the original terminal retains its writer and completes another
      inference. Reconstruct twenty-three stages and compare seventeen files.
- [x] Finish reconstructed-package regressions: metadata 54, shell 28,
      authentication 41/30/11, child refusal/private behavior, terminal metadata
      refusal, writer-owner recovery and both admission interruption controls.
      Python AST, formatting, actionlint/ShellCheck, file limits, secret scanning
      and whitespace checks pass. The final actual rollback check also verifies
      the substituted audit inode is unchanged on refusal.
- [ ] Commit/push the evidence stage and require strict before, legitimate peer,
      actual refusal and fresh-source controls in exact-head Node 24 CI.
      Persisted fresh-process rollback authority and publication/power-loss
      coverage remain unfinished.
