---
"@link-assistant/hive-mind": patch
---

Implement fail-fast CI strategy for release.yml workflow

- Added dependency ordering so long-running checks wait for all fast checks to pass
- Fast checks (test-compilation, lint, check-file-line-limits) run first (~7-21s each)
- Long-running checks (test-suites, test-execution, memory-check-linux, docker-pr-check) only run after fast checks pass
- Added smart conditionals with `!contains(needs.*.result, 'failure')` to skip long checks when fast checks fail
- Added section markers to clearly document FAST vs LONG-RUNNING checks in the workflow

Benefits:
- Time savings: If fast checks fail, ~4+ minutes of long-running tests are skipped
- Faster feedback: Developers get quick feedback on common issues
- Resource efficiency: Reduces unnecessary GitHub Actions minutes consumption
