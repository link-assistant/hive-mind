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
- [ ] Implement canonical auth/history authority, explicit alternative contracts,
      coordinated refresh and fail-closed effective-path validation for all tools.
- [ ] Isolate task catalogs/extensions and enforce clean global baseline; migrate
      persisted full homes with an allowlist preserving auth/conversation evidence.
- [ ] Add production Docker lifecycle tests (root/two tasks, refresh/atomic writes,
      history/resume, overrides/contamination, cleanup, host/nested daemon layouts).
- [ ] Require packaged-image tests and deployment preflight in release workflows.
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
