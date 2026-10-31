# Router monitoring across post-spawn awaits

- [x] Exercise all four additional actual production adapters with bounded
      synthetic commands, isolated directories and ten-second test deadlines.
- [x] Reproduce new/resumed, environment/argv-selected post-spawn logging
      failures: 32 security failures and 16 abandoned-command cleanup failures.
      Preserve the before log outside the repository; no live credentials.
- [x] Trace actual command-stream startup: ordinary commands are lazy; Agent
      streaming input starts through streams.stdin before output iteration.
      Reproduce an actual finite parent/child group surviving forbidden auth
      during pending logging, and an ordinary logging failure abandoning the group.
      All 50 combined controls fail before repair; kill/reap fixtures in cleanup.
- [x] Finish and commit the preceding admission step after repository checks.
- [x] Start monitoring immediately after native command creation, before input
      attachment or logging; retain a detected violation after its file disappears.
- [x] Stop abandoned commands before closing monitoring when output is never consumed;
      preserve existing streaming, resume and ordinary error behavior.
- [x] Require all 50 before controls to pass and add two default-suite wrappers.
- [x] Re-run affected controls, complete repository checks and default tests;
      record exact evidence and commit this independent repair.
- [ ] Preserve preceding optimized CI artifacts before pushing the prepared branch.
      Native request authority, all credential stores, process-tree lifetime,
      Claude/Codex monitoring and full Router audit/lifecycle remain OPEN.
