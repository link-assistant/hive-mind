# F3 — CI "tests" that can never fail (false positives)

**Severity:** High · **Class:** False positive (green check that verifies nothing)

These scripts run in the `test-execution` job. Every one of them exits 0 unconditionally,
so the green check they produce carries zero signal.

## F3.1 `scripts/test-auto-fork-option.sh`

```bash
timeout 10s ./src/solve.mjs ... --auto-fork --dry-run 2>&1 | tee solve_auto_fork.log || true
if grep -qE "(auto-fork|Auto-fork)" solve_auto_fork.log; then
  echo "solve.mjs recognizes --auto-fork flag"
else
  echo "Could not verify --auto-fork flag in solve output"   # <-- no exit 1
fi
```

Two independent defects compound:

1. `|| true` discards the command's exit status (and the `tee` pipeline already masks it
   absent `pipefail` on that line).
2. The `else` branch **prints a message and continues**. A total absence of `--auto-fork`
   support still exits 0.

Same shape repeats at lines 18, 27 and 38 (`solve.mjs`, `hive.mjs`, `start-screen.mjs`).

## F3.2 `scripts/test-global-commands.sh`

```bash
timeout 10s hive --version || true
timeout 10s hive --help || echo "Help command completed"
echo "'hive' global command works"      # <-- printed unconditionally
```

If `hive --version` segfaults and `hive --help` fails, the script still announces
_"'hive' global command works"_ and exits 0. Repeated for `solve` at lines 26–28.

## F3.3 `scripts/verify-log-file-contents.sh:15`

```bash
timeout 30s ./src/solve.mjs ... --dry-run 2>&1 | tee test-log-output.txt || true
```

Same `|| true` masking.

## Root cause

A deliberate pattern of "tolerate the command failing, then inspect its output" was
applied without ever converting a failed inspection into a non-zero exit. The `|| true`
is defensible on its own — these commands are _expected_ to exit non-zero in dry-run mode
— but the follow-up `grep` assertions were written as advisory `echo`s rather than gates.

## Proposed fix

For each script:

- Keep `|| true` only where a non-zero exit is genuinely expected, and add
  `set -o pipefail` so `tee` does not mask real signal elsewhere.
- Convert every advisory `else` branch into a hard failure:

```bash
if grep -qE "(auto-fork|Auto-fork)" solve_auto_fork.log; then
  echo "solve.mjs recognizes --auto-fork flag"
else
  echo "FAIL: --auto-fork not recognized in solve output" >&2
  exit 1
fi
```

- In `test-global-commands.sh`, assert on the actual output (e.g. that `--version`
  prints a semver) instead of printing an unconditional success line.

## Cross-check requirement

The issue asks that fixes be applied everywhere the problem exists. Sweep for the pattern
across all of `scripts/*.sh`:

```
$ grep -rn '|| true' scripts/*.sh
scripts/test-auto-fork-option.sh:18,27,38
scripts/test-global-commands.sh:20,26,34,56
scripts/verify-log-file-contents.sh:15
```

`test-global-commands.sh:34,56` (`npm unlink -g ... || true`) are legitimate cleanup in a
`trap` and should be left alone — cleanup failures should not fail the job.
