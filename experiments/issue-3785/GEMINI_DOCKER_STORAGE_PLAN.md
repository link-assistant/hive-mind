# Selected native Gemini Docker storage

The packaged Gemini adapter already has actual native auth-writer/request and
full-history controls. Production default migration is still missing, and the
Docker launcher initially rejected both Gemini canonical selectors outright.
This plan is an independent projection repair, not a claim of default activation.

- [x] Inspect native recipe installation, existing strict credential-file
      admission, Codex/Claude parent-directory projections and the Docker
      unsupported-selector gate.
- [x] Trace native Gemini selected auth and history behavior. Authentication
      reads/writers retain one selected root; history holds directory handles
      and checks the selected root and all retained child identities.
- [x] Finish the current frozen combined default-suite run and preserve its
      exact result before changing production sources or probe dependencies.
- [x] Write minimal isolated projection controls reproducing current refusal
      of valid selected Gemini auth/history directories. Include missing,
      malformed, symlinked, overlapping, changed-identity and divergent-private
      authorities, plus Router suppression and ordinary unselected controls.
- [x] Reuse canonical credential admission and bounded directory preparation;
      project dedicated parent directories, never credential file inodes or
      whole executable/configuration homes. Carry the selected identities into
      pre-daemon mount-source resolution and final native launch admission.
- [x] Add Gemini selected auth/history projection without permitting unsupported
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

The production-builder fixture in `probe-gemini-docker-projection.mjs` has 30
finite tests. Nineteen invalid-selection and compatibility controls pass before
repair; eleven positive/lifetime controls fail because valid initial projection
is refused. The strict before result is preserved. All 30 pass after repair;
the separate frozen launcher-admission default suite passed all 767 files before
these production sources changed.

Reuse a separate canonical-directory admission primitive in both the launcher
and projection. Docker preparation does not execute the host Gemini command;
the actual child launcher must still verify its own installed native bytes.
Project auth/history parents independently, retain original selectors/markers
and both directory identities through daemon source resolution, and reject
Docker's ambiguous comma/colon source syntax before preparing legacy state.

The first complete native Docker control passes with the current production
builders and exact verified native package in the local nested daemon. Four
complete conversations preserve original user/model content through root, two
live peers and fresh-root resume after whole private-home disposal. Actual
external atomic credential publication advances G0/G1/G2; removal refuses root
and both peers, and re-publication recovers. A legacy credential-file bind keeps
G0 and refuses after its source is retired. This does not establish concurrent
native refresh, native logout writer behavior or replacement of a host parent
after that parent has already been bound into a peer.

The fixture uses Debian's util-linux flock. Alpine's BusyBox flock lacks the
timed-lock option required by this native adapter; the first Alpine run correctly
refused history rather than claiming a conversation. For host-socket checks,
copy the actual installed launcher source and native package onto the shared
fixture backing, compare every copied launcher source file, and verify the
complete native byte inventory again inside each peer. Both final-image daemon
gates are wired; their actual execution remains required before claiming that
matrix passes. Repeat the stronger marker/provenance controls against a fresh
extracted npm artifact before committing this repair.
