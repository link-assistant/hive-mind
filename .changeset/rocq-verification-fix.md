---
'@link-assistant/hive-mind': patch
---

Fix Rocq installation verification (issue #952)

- Installation script: Check binary accessibility instead of just package listing
- Installation script: Use `opam pin add rocq-prover` per official documentation
- CI workflow: Require Rocq accessibility in container (not optional)
- CI workflow: Enhanced diagnostics when Rocq verification fails
- Dockerfile: Add opam environment variables (OPAM_SWITCH_PREFIX, CAML_LD_LIBRARY_PATH, OCAML_TOPLEVEL_PATH)

References:

- Issue: https://github.com/link-assistant/hive-mind/issues/952
- Rocq docs: https://rocq-prover.org/docs/using-opam
