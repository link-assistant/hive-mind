# Claude effective configuration history

This bounded repair follows the native `CLAUDE_CONFIG_DIR` selector for the two
existing Claude history mounts. Complete history, default authentication and
migration remain open in the original issue inventory.

- [x] Run five production filesystem reproductions before repair: preparation
      uses the wrong root, both mount sources use the wrong root and linked
      selected storage is ignored despite healthy conventional directories.
- [x] Resolve the same selected source for preparation and mount construction;
      preserve private container targets and independent credential selection.
- [x] Preserve conventional evidence and reject unsafe or missing selected
      storage. Check Router suppression before filesystem creation.
- [x] Add all reproductions to the default suite and retain the standalone
      experiment; all 23 focused history controls pass.
- [x] Run all 132 related mount and isolation controls sequentially.
- [x] Verify the actual pinned Claude CLI through production Docker mount
      builders: reproduce lost resume with conventional sources, then retain
      the original message across two disposable peers with selected sources.
- [x] Add the native history control to the existing installed-image gate for
      both daemon layouts, using the root's network namespace for its stub.
- [x] Run repository checks and the complete default suite without overriding
      worker heap controls.
- [x] Record verification evidence, review and commit this atomic change.
- [ ] Preserve ongoing optimized CI results, push only the prepared branch and
      verify the new head's required checks.
