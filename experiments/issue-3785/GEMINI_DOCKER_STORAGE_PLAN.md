# Selected native Gemini Docker storage

The packaged Gemini adapter already has actual native auth-writer/request and
full-history controls. Production default migration is still missing, and the
Docker launcher currently rejects both Gemini canonical selectors outright.
This plan is an independent projection repair, not a claim of default activation.

- [x] Inspect native recipe installation, existing strict credential-file
      admission, Codex/Claude parent-directory projections and the Docker
      unsupported-selector gate.
- [x] Trace native Gemini selected auth and history behavior. Authentication
      reads/writers retain one selected root; history holds directory handles
      and checks the selected root and all retained child identities.
- [x] Finish the current frozen combined default-suite run and preserve its
      exact result before changing production sources or probe dependencies.
- [ ] Write minimal isolated projection controls reproducing current refusal
      of valid selected Gemini auth/history directories. Include missing,
      malformed, symlinked, overlapping, changed-identity and divergent-private
      authorities, plus Router suppression and ordinary unselected controls.
- [ ] Reuse canonical credential admission and bounded directory preparation;
      project dedicated parent directories, never credential file inodes or
      whole executable/configuration homes. Carry the selected identities into
      pre-daemon mount-source resolution and final native launch admission.
- [ ] Add Gemini selected auth/history projection without permitting unsupported
      selector fallbacks. Verify actual child env, CLI byte provenance and
      fresh private configuration paths before any native version/provider probe.
- [ ] Add finite root plus two Docker peer controls using the exact verified
      native package and production builders. Preserve actual replacement,
      logout/re-login and full conversation discovery/resume/private disposal
      evidence; retain negative file-bind/redirect controls.
- [ ] Run affected/default tests and quality checks, record exact digests and
      daemon-layout limits, then commit the independent repair.
- [ ] Complete separate allowlist migration and default selection before
      claiming the no-extra-flags six-tool storage acceptance criterion.
