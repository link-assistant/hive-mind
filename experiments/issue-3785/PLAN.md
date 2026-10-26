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
- [x] Inventory every acceptance criterion in docs/case-studies/issue-3785.
- [x] Trace limits rendering, credential selection/refresh, task preflight,
      mounts, resume/recovery, image startup and deployment paths.
- [x] Reproduce layout and credential divergence with synthetic automated tests
      before changing implementation; keep probes here and bound their resource use.
- [x] Fix Claude section layout, entitlement detection and honest stored metadata.
- [x] Partition cache by effective home and credential generation; invalidate on logout.
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
- [x] Commit useful atomic steps after checks; integrate latest main; review diff.
- [x] Update PR title/body with evidence, reproduction and Fixes #3785; push branch.
- [ ] Verify newest-SHA CI, download/analyze nonpassing logs, fix actual failures.
- [ ] Confirm clean working tree and requirements/evidence consistency; mark ready
      only when implementation and verification are complete. Do not merge.

Resource policy: use sequential builds/tests; no real credentials in experiments
or artifacts. Current cgroup usage is mostly reclaimable file cache. Measure
before heavy commands and do not retry an OOM build unchanged.
