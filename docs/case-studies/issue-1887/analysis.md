# Technical analysis — Issue #1887

## 1. How `--auto-restart-until-mergeable` decides to restart

The loop lives in `src/solve.auto-merge.lib.mjs`. After a working session, it inspects the PR
for _blockers_ and, if any are found, builds a `feedbackLines` array and restarts the AI with
it. The CI blocker path (≈ lines 561–576) is:

```js
if (ciBlocker && !billingBlocker) {
  shouldRestart = true;
  restartReason = restartReason ? `${restartReason}; CI failures` : 'CI failures detected';
  feedbackLines.push('❌ CI/CD checks are failing:');
  // … per-check details …
  feedbackLines.push('Please fix the failing CI checks.');
}
```

When `shouldRestart` is true and the iteration limit is not reached, it appends the standard
instructions:

```js
feedbackLines.push(...buildAutoRestartInstructions());
```

`buildAutoRestartInstructions()` (in `src/solve.restart-shared.lib.mjs`) is the **single shared
prompt** used by both `--auto-restart-until-mergeable` and watch-mode, for **every** AI tool.
That makes it the highest-leverage place to add the nudge — one edit reaches all tools.

The restart logic itself is correct: the PR was genuinely not mergeable (E2E red), so a restart
is the right mechanical response. The problem is purely what the restarted AI is _told_.

## 2. Why the AI chose to escalate instead of fix

The exact text the model received during the loop is preserved in
`data/auto-restart-prompt-before-fix.txt`. The only CI-related instructions were:

```
❌ CI/CD checks are failing:
  - E2E Tests

Please fix the failing CI checks.
...
Ensure you comply with all CI/CD check requirements, and they pass.
```

The model investigated and produced a **well-reasoned, evidence-backed** conclusion (see
`data/ai-decision-comments.md`):

- `release` base @ `5893882` (PR #168) — run `27292145950`: **61 E2E failures**.
- PR #170 — run `27298783487`: **the same 61 failures**, +2 new passes (its own new test).
- Therefore the PR adds **zero** new failures; the red is inherited from #168's deliberate app
  changes (commenting out the onboarding wizard, requiring auth before task launch), which
  removed the flows ~29 tests assert against.

From the agent's local perspective this is textbook good behavior: _"don't pull a large,
out-of-scope test rewrite into a small feature PR without a green light."_ It asked the
maintainer to choose between (1) merge despite inherited red, or (2) a separate migration PR.

The gap: nothing told the agent that under this flag, **"ask and stop" is not a terminal state**
— the loop restarts and re-asks forever, and that keeping the base/default branch green is a
legitimate, in-scope goal unless the user said otherwise.

## 3. Root cause statement

> The auto-restart and base system prompts framed CI compliance narrowly ("comply with … and
> they pass") and never declared inherited / repository-wide breakage to be in scope. A
> correctly-reasoning agent therefore escalated an inherited failure to a human instead of
> fixing it, which `--auto-restart-until-mergeable` cannot resolve without a human, producing a
> non-converging loop.

It is a **prompt/scope-communication** defect, not a control-flow defect.

## 4. The change and why it is shaped this way

- **Shared auto-restart prompt** (`buildAutoRestartInstructions`): adds (a) "fix it even if it
  looks pre-existing/inherited/unrelated", (b) an explicit statement that _this session
  auto-restarts until mergeable, so leaving a failing check unaddressed loops indefinitely_ —
  giving the model the missing context about its own loop — and (c) "repository-wide breakage is
  in scope unless explicitly restricted", while preserving the human escape hatch ("attempt your
  best fix first, then leave a clear comment").
- **System prompt** (all six tools): two always-on `When x, do y.` bullets so the default
  behavior shifts even outside auto-restart mode. These are intentionally _soft_ ("work to make
  them pass", "assume the scope … unless the user explicitly restricts") per the issue's
  "no forcing" instruction.

### Why not a hard gate?

A hard rule ("never end while CI is red") was rejected: genuinely human-only blockers exist
(infra outages, secrets, policy). Forcing would convert a "loop asking for a decision" into a
"loop unable to stop", which is no better. Increasing probability + giving the model awareness of
the loop is the proportionate fix the issue asked for.

## 5. Verbose / debug sufficiency (Requirement R6)

The root cause was fully recoverable from existing instrumentation: the attached solution-draft
log (produced with `--verbose --attach-logs`) already prints the **entire** prompt and system
prompt the model receives (`📝 Raw command:` … `--append-system-prompt …`). That is precisely
what let us read the exact wording the agent acted on. No additional tracing was needed, so none
was added (adding noise without need would regress log readability). If future cases need it, the
`📝 Final prompt structure` / `System prompt characters` lines already exist as hooks.

## 6. Third-party reporting (Requirement R7)

The triggering repository `lefinepro/kefine` is the _target_ of a solve run, not the source of
the defect. The actual defect is in **hive-mind's** prompts (this repo). The inherited E2E
breakage in kefine is a real test-debt item, but it belongs to kefine's own PR #168 and is the
subject the AI was (correctly) flagging — it is not a hive-mind-reportable third-party bug. No
external issue was filed; doing so would be noise.
