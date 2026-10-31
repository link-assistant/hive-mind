# Preserve Agent default-model validation coverage

- [x] Preserve the complete default-suite failure: the issue-2625 source-shape
      assertion expects the former direct command tag, which the shared Router
      connection runner now wraps. This is an affected default test, not the
      unrelated previously marked needs-triage activity-timeout test.
- [x] Inspect the existing overlay contract: ordinary Agent default model
      nemotron-3-super-free maps to kilo/nemotron-3-super-free and the inline
      definition identifies nvidia/nemotron-3-super-120b-a12b:free.
- [x] Let the full suite finish against frozen production/probe sources and
      inventory every actual failure before changing tests.
- [x] Extend the existing ordinary-Agent production-validator control to request
      the default free model and assert the actual paid child environment's
      model id, zero cost and preservation of unrelated inline configuration.
- [x] Replace only the obsolete connection-tag source assertion with this
      finite behavior control. Preserve task-execution overlay coverage.
- [x] Run the affected issue-2625 test and the complete connection probe after
      updating them, plus required quality checks, then preserve exact evidence.
- [x] Record the initial full-suite result and paired rerun honestly; do not
      present the initial failed command as a passing full-suite invocation.

The initial 765-file invocation finishes with 764 passing files and the one
obsolete assertion failure. The production sources remain unchanged. The final
affected entrypoints pass nine Agent tests and all 66 connection-lifetime cases.
The isolated name-filter run also reproduced premature global fixture cleanup
while later tool modules were still importing. Preload every validator before
registering tests; the actual behavior control now covers that filtered path.
