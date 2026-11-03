# Native package activation after Bun installation

- [x] Preserve the failed f7b1f506d release logs and verify the run timestamp and
      commit. Optimized and npm-installed controls passed; Docker activation
      failed at Dockerfile:376 before its runtime checks.
- [x] Trace the difference: Bun 1.4.4 defaults to its hardlink backend, whereas
      native Codex admission requires single-link package metadata and payloads.
- [x] Reproduce with real Bun, tiny synthetic packages and the actual production
      image installer and native activation functions. Never execute ELF-shaped
      fixture bytes. Keep all global installs and caches inside a temporary root.
- [x] Select Bun's copyfile backend in all three image layouts and the source-package
      installer, including subsequent global installs. Preserve strict runtime
      admission and ordinary command publication checks.
- [x] Verify all three layouts, package-source installation, later global installs,
      preserved stock bytes, native idempotence and independent cache inodes.
- [x] Run affected/default and quality checks and preserve exact failure/repair
      evidence. All affected tests pass; the full 766-file run has one unrelated
      intermittent help failure, whose original three-case entrypoint passes
      on rerun. Preserve both results, without claiming the invocation passed.
- [x] Commit and push the independently verified installation repair (706b34b11,
      included in 6d4275541). Fresh release run 41225226347 starts at
      2026-10-31T17:34:56Z against that exact pushed head.
- [ ] Inspect the next full Docker CI result against its exact head and time.

This repairs package installation, not the separately reproduced native SQLite
operation-lifetime defect or the remaining canonical storage/migration criteria.
