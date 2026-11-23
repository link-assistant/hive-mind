# Router connection probe lifetime

- [x] Trace all six production connection validators, including version checks,
      paid validation, Claude fallback and Agent/Codex environment overlays.
- [x] Reproduce argument-only selection missing from actual child environments,
      credentials appearing during version and paid commands, and removed-file
      violations losing precedence to ordinary errors. Preserve the strict
      60-case before control (6 pass, 54 fail).
- [x] Admit the exact command environment and forward argument-based selection
      to actual native probes. Preserve ordinary command tags and custom envs.
- [x] Arm monitoring before awaiting a lazy native command, stop on violation,
      retain the first refusal, and close monitoring on success and failure.
- [x] Verify the 60 paired cases and ordinary validation controls (66 pass).
- [x] Add a default-suite wrapper and run affected tests plus quality checks.
- [x] Record before/after evidence, review the change, and commit atomically.
- [x] Include the wrapper in the complete combined default suite before push.
      All 765 files ran; the separate Agent source assertion was replaced with
      actual child-environment coverage and both affected entrypoints pass.

The synthetic native commands exercise production validator admission and
monitoring. They do not establish native provider request authority, process
subtree cancellation, production OAuth availability, or the complete Router
lifecycle/audit acceptance criteria.
