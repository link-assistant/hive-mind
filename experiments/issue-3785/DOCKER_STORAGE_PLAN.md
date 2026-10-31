# Native Docker storage integration

Issue 3785 requires host-backed authentication and conversation evidence by
default. The current selector refusal prevents silent fallback but does not
provide that integration. Keep the complete acceptance inventory open.

- [x] Reproduce rejection of a valid dedicated Codex authentication directory
      through the actual production mount and command builders.
- [x] Bind that directory, propagate its container selector, and preserve
      configuration isolation. Reject legacy competing credentials and unsafe
      paths before host preparation. Keep unsupported history/tool selectors
      explicitly refused.
- [x] Carry the admitted directory identity through launch, preflight and native
      credential reads. Reproduce substituted equal-content storage before its
      repair; recheck directory identity without logging credentials.
- [x] Exercise host and two concurrent Docker peers with the actual native CLI:
      replacement, logout, reauthentication, private-home disposal and refusal.
      Preserve the file-bind negative control. Bound processes and reap them.
- [x] Require the same controls in both installed branch-package image checks.
      Wiring is complete; their execution with the new compiled identity
      admission remains pending. The local lifecycle run uses the preserved
      a3 development CLI and current production projection code.
- [x] Run 134 focused tests, eight native primitive tests, nineteen build tests,
      format/lint/workflow checks and the actual Docker lifecycle control.
      Review the independently useful projection before its atomic commit.
- [ ] Finish the running 752-file default suite and the new compiled native
      controls. Preserve both optimized outputs before pushing (both archived).

Default selection, safe legacy migration, all history projections and the other
five tools remain required work after this bounded integration step.
