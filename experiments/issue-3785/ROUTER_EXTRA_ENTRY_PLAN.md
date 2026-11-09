# Remaining direct Router entry points

Reproduce these four direct entry points. Native commands are mocked; use only isolated HOME
and XDG directories and synthetic credentials, bounded calls and test deadlines.

- [x] Reproduce credential/endpoint divergence in Agent, OpenCode, Gemini and
      Qwen new/resumed execution and connection checks, with healthy controls.
- [x] Commit the preceding task-environment change after its full suite passes.
- [x] Check the final merged native environment immediately before every
      command creation; preserve typed security refusal through fallback/retry.
- [x] Preserve normal execution, resumes, streaming input and version gates.
      Prevent a Router Qwen launch from replacing its environment via profiles.
- [x] Add default-suite regressions and pass all 194 matrix cases / 295 focused
      controls, including output-consumer failures and Hive security exit 77.
- [x] Run repository checks and the complete 758-file default suite, finish evidence
      and commit atomically. Earlier post-spawn awaits need separate coverage.
- [ ] Preserve preceding release CI/artifacts before pushing the prepared branch.
      Full six-tool authority, runtime mediation and durable audit remain OPEN.
