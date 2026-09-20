# Analysis — Issue #1883

## Root cause

The AI solver is given a single pull request and a finite (auto-compacting)
context. When the task is large, the model has a strong tendency to **bound the
work to fit the run** rather than the requirements: it ships a partial result and
labels the remainder "out of scope", "future work", "to be done in a follow-up
PR", or leaves `TODO`/`TBD` markers. In this workflow there is **no follow-up
PR** — each issue maps to exactly one PR — so any deferred work is silently
dropped and the issue is reported "done" while it is not.

The fix is not to make the model smarter mid-run; it is to **detect the
self-reported deferral after the run and feed it back as a fresh mandate**, until
the deferrals stop appearing.

## Why detection (not a smarter single prompt)

A single "do everything" prompt already exists in spirit, yet models still defer.
Detection-and-restart is robust because:

- It is **observable** — we act on the model's own written output, not on a guess
  about its internal state.
- It is **convergent** — each restart targets the _specific_ phrases found, and
  the loop terminates precisely when those phrases disappear.
- It is **cheap** — scanning is pure string work over three small sources; no
  extra model calls are spent on classification.

## Design decisions and trade-offs

### 1. Pure detection module, network-free

`src/solve.keep-working.detect.lib.mjs` contains only pure functions (regexes,
normalization, feedback building). It imports nothing that touches the network or
`use-m`. This follows the repo idiom (cf. `auto-iteration-limits.lib.mjs`) and
makes the whole detection surface unit-testable without mocks. The orchestration
module (`solve.keep-working.lib.mjs`) is the only part that talks to `gh`/git.

### 2. High recall, accepted false positives (R6)

The issue explicitly says to **ignore false positives for now** — the user would
rather the AI keep going than stop early. So patterns are deliberately broad and
**any** match restarts the loop. The cost of a false positive is one extra
restart, which is bounded by the limit; the cost of a false negative is a
permanently unfinished issue. We optimise against the worse failure.

### 3. The reinforcement prompt must not self-trigger

The injected `KEEP_WORKING_PROMPT` contains words like "until" and "everything",
and `buildKeepWorkingFeedback` legitimately contains deferral vocabulary
("there is no future pull request", "deferred"). If those scanned back in, the
loop could never converge. Two safeguards:

- **The prompt and the feedback block are never scanned.** Only the three
  external sources (PR body, AI summary, changed markdown) are scanned.
- Patterns are anchored to _deferral phrasing_ ("left for a future PR") rather
  than bare keywords, so the reinforcement prompt itself does not match. A unit
  test asserts `detectDeferredWork(KEEP_WORKING_PROMPT)` returns no detections.

### 4. Bounded restarts + consecutive-error cap (R7, infinite-loop safety)

Long-horizon agent loops are known to occasionally get stuck. Two independent
bounds prevent runaway cost:

- **Restart limit** — default 5, configurable, or `Infinity` for "forever".
- **Consecutive-error cap** — even in `forever` mode, 3 consecutive tool errors
  (API errors / usage-limit reached) abort the loop. A genuinely broken
  environment can never spin indefinitely.

### 5. Recursion guard

Each restart calls `executeToolIteration` with
`keepWorkingUntilAllRequirementsAreFullyDone: 0` (and
`promptEnsureAllRequirementsAreMet: true`) so a nested run cannot launch its own
keep-working loop. The loop is owned solely by the outer orchestrator.

### 6. Limit value model

`normalizeKeepWorkingLimit` collapses the messy CLI surface into two cases: a
finite integer ≥1, or `Infinity`. `0` and the unlimited keywords both mean
"no limit". `undefined`/`false`/empty mean "feature disabled". This keeps every
downstream check a simple `iteration >= limit` comparison, with `Infinity` making
it never fire.

## Token-cost accounting (R5)

| Source              | Cost per restart-decision                            |
| ------------------- | ---------------------------------------------------- |
| PR description      | 1 `gh api` REST call (`.body`)                       |
| AI solution summary | 0 — already in memory from the run                   |
| Changed markdown    | 1 paginated `gh api` files call; only `+` lines kept |
| Detection           | 0 model tokens — pure regex                          |

No model tokens are spent deciding _whether_ to restart; tokens are spent only on
the restart itself, which is the actual useful work.

## Alternatives considered and rejected

- **PEG grammar / full parser.** The issue allowed "regex or PEG or similar".
  A PEG buys nothing here: we are doing keyword/phrase _occurrence_ detection, not
  structured parsing. Regexes are simpler, faster, and easier to extend.
- **Ask the model "are you done?"** Spends tokens, and the model's self-assessment
  is exactly what we distrust (it already said "done" while deferring).
- **Scan the full diff / all files.** Wastes tokens and noise; the issue scoped us
  to PR description + AI summary + changed markdown specifically.
