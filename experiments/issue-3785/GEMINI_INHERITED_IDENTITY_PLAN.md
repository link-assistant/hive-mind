# Native Gemini inherited storage identities

The Docker projection plan requires the native process to compare the mounted
directory with the identity admitted by its launcher. Existing helpers retain
the first directory they see, so a replacement before native initialization can
become a different authority without detection.

- [x] Reproduce ignored authentication and history identity markers using the
      complete pinned native CLI and bounded, synthetic loopback provider.
- [x] Apply an exact-source final adapter stage that admits inherited identities
      before auth/account reads and history initialization, retains them for the
      process lifetime, and refuses missing selectors or changed markers.
- [x] Verify healthy marked and ordinary unmarked behavior, wrong/malformed
      identities and marker changes/removal through isolated native controls.
- [x] Rebuild the native package recipe and verify the installed artifact matches
      the tested adapter; add the same controls to its workflow/package gates.
- [x] Run affected checks and preserve exact evidence before an atomic commit.

This step supplies native admission only. Selected Docker mounts, default
canonical activation/migration, all daemon lifecycles and the complete six-tool
acceptance inventory remain separate unfinished work.
