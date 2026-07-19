# F23 — `test-issue-1209-overrides.mjs` is flaky: a unit test gated on a live CDN

**Severity:** Medium · **Class:** False positive (a red build caused by the network, not by the code)
**Status:** Diagnosed, **not fixed in this PR** — see "Why not fixed here"

## Symptom

The test fails intermittently, with a _different_ subset of its 11 cases failing each run:

```
run 1 → Total: 11 | Passed:  9 | Failed: 2   (--gitkeep-file, --base-branch)
run 2 → Total: 11 | Passed: 11 | Failed: 0
run 3 → Total: 11 | Passed: 10 | Failed: 1   (--gitkeep-file)
```

All failures share one message: `Exit code null without dry-run success message`.
`null` is not an assertion failure — it is the exit code Node reports for a process
killed by a signal.

## How it was nearly misattributed

The flake first appeared immediately after the F22 change to `src/config.lib.mjs`, and
the obvious control — reverting that change and re-running — **passed 11/11**. That
looked like proof of causation. It was luck. Running the _same_ reverted tree three more
times produced 2, 0 and 1 failures. A single green run of a non-deterministic test is
worth nothing as evidence, in either direction.

## Root cause

The test spawns `src/telegram-bot.mjs` once per case and kills it after a fixed 12s:

```js
const proc = spawn('node', [join(projectRoot, 'src/telegram-bot.mjs'), ...args], { timeout: 15000 });
const timeout = setTimeout(() => {
  proc.kill('SIGTERM');
}, 12000);
```

Measured startup on an idle machine, five consecutive runs:

```
9009 ms   8107 ms   8639 ms   7030 ms   7542 ms
```

7–9 seconds against a 12-second kill: roughly 3 seconds of headroom. Eleven of these run
back to back, and the suite runs other work alongside them, so the margin disappears
under load and SIGTERM lands mid-startup.

The startup cost is not CPU. `telegram-bot.mjs` bootstraps `use-m` over the network on
every launch:

```js
export const USE_M_BOOTSTRAP_URL = 'https://unpkg.com/use-m/use.js';
```

So each of the 11 cases performs a live round-trip to unpkg.com. The test's pass/fail
outcome is a function of CDN latency at that moment.

This also explains why CI is comparatively stable: the `test-suites` job runs a
`Pre-install use-m packages (issue #1724)` step beforehand, which warms the path that the
local runs pay for in full. CI is not immune, only better insulated — and an unpkg.com
slowdown would redden the build with nothing wrong in the repository.

## Why raising the timeout is the wrong fix

It converts an 8-second network dependency into a 30-second one and hides the coupling.
Per `docs/CI-CD-BEST-PRACTICES.md`, a repeated timeout pattern is to be root-caused rather
than padded. The defect is that a unit test asserting **CLI argument parsing** — pure,
local, offline logic — cannot run without reaching the public internet.

## Recommended fix

In priority order:

1. Make `ensureUseM` resolve from a local cache when the dependency is already installed,
   so process startup does not require the network. This is the real fix and benefits
   every spawned process, not just this test.
2. Failing that, have the test assert argument validation against the parsing module
   directly instead of spawning a full bot process per case — 11 process launches to
   check 11 flag spellings is the expensive part.
3. Only then, treat the kill as a diagnostic rather than a verdict: report "timed out"
   distinctly from "assertion failed", so a network stall is never reported as a code
   defect. The current message conflates them.

## Why not fixed here

Each option above changes process bootstrap or test architecture well outside the CI/CD
configuration work in this PR, and option 1 affects every entry point in the project. The
finding is recorded with a quantified reproduction so the fix can be scoped on its own
evidence rather than folded in unexamined.
