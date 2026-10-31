# Claude and Codex Router command lifetime

- [x] Trace actual production execution and existing timeout/process-tree behavior.
- [x] Reproduce 28 failures in 32 isolated native-command mocks: new/resumed,
      env/argv selection, persistent/removed violations and abandoned logging.
      Four environment-selected healthy controls pass; argv-selected healthy
      controls reproduce missing selection in the actual native environment.
- [x] Finish and commit the preceding four-adapter command-lifetime change.
- [x] Admit and forward selection in the actual final native environment.
- [x] Arm retained monitoring before post-command input/logging awaits. Stop
      on a violation independently of asynchronous diagnostic logging.
- [x] Stop abandoned commands before releasing monitoring; preserve sticky
      violations through stream/consumer errors and disable ordinary retry.
- [x] Keep timeout/result-close/process-tree and streaming/resume behavior.
- [x] Require all 32 controls and affected existing regressions to pass;
      verify bounded real-process cleanup and add default-suite regressions.
- [x] Complete affected tests and repository quality checks; preserve exact
      evidence and commit this independent repair.
- [ ] Include both wrappers in the combined complete default suite after the
      independent guard/store repairs, before the next authorized push.

Full native request authority, all credential stores and durable Router audit,
restart/failure behavior and the six-tool storage contract remain OPEN.
