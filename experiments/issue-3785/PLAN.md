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
- [ ] Build the extended native CLI in CI; require all eight actual staging link
      refusals and plain/compressed/child interrupted-migration recovery controls.
      Keep remaining child lifecycle and readers/writers, post-publication crashes,
      power-loss durability and production installation explicitly unfinished.

- [x] Verify exact-head 2ec3b3a7c Checks and release run 41087509851: 737
      default files, both integration files and packaged host/nested Docker checks
      pass. Preserve logs and line-numbered evidence.
- [x] Download failed native run 41087509499 and all artifacts. Its seven passing
      constructor cases are followed by an unhandled ECONNRESET in the local
      CONNECT refusal socket, not an alternate-authority assertion. Reproduce
      three error-handler failures before repair; all four controls pass after.
- [ ] Verify the next compiled native run after the proxy and migration staging
      repairs. Current native CI remains failed at the fixture reset.
