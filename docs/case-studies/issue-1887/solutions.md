# Solution options and plan — Issue #1887

## Options considered

### Option A — Soft prompt nudges (chosen)

Add `When x, do y.` guidance to the system prompt and the auto-restart feedback prompt that
biases the agent toward fixing inherited/repository-wide CI failures, and explicitly tells it the
session loops until mergeable.

- **Pros:** Matches the issue's "no forcing, increase probability" requirement exactly; cheap;
  reaches all tools; preserves the human-escalation escape hatch; no behavioral regression for
  the common case where the agent _was_ going to fix anyway.
- **Cons:** Probabilistic — a model may still escalate. Mitigated by stating the loop consequence
  so the model understands escalation alone will not converge.

### Option B — Hard gate in the restart logic

Refuse to treat the session as "done/handed-off" while CI is red; force another iteration with an
escalating prompt, or only stop at the iteration limit.

- **Pros:** Deterministic.
- **Cons:** Rejected. Genuinely human-only blockers exist (infra, secrets, policy); a hard gate
  turns "loop asking" into "loop unable to stop". The iteration cap already bounds runaway loops;
  the real fix is to make the agent _use_ its iterations to fix rather than escalate.

### Option C — Auto-detect "inherited failure" and auto-stop/label

Compare the PR's failing checks against the base branch; if identical, stop the loop and
post a "blocked on base branch" label instead of restarting.

- **Pros:** Directly targets the kefine scenario; could prevent the loop entirely.
- **Cons:** Larger surface area, network-heavy, easy to get wrong (flaky tests, partial overlap,
  different SHAs). It also encodes "inherited = don't fix", which conflicts with R3's "keep the
  default branch clean → fix it anyway". Good **future** enhancement, but it changes policy and
  belongs in its own issue. Noted here as follow-up, not implemented (and not silently assumed).

### Option D — A dedicated `--prompt-*` experimental flag

Gate the new guidance behind a flag like the existing `--prompt-case-studies`,
`--prompt-issue-reporting`.

- **Pros:** Opt-in, conservative.
- **Cons:** The issue asks to update the **system prompt** generally ("in general it is good
  idea …"), and the guidance is broadly beneficial best practice, not an experiment. Gating it
  would mean the default behavior — the one that caused the loop — stays unchanged. Rejected for
  the always-on bullets; the wording is kept soft to compensate.

## Chosen plan (implemented in PR #1888)

1. `src/solve.restart-shared.lib.mjs` → `buildAutoRestartInstructions()`: add the fix-inherited
   - loop-awareness + repo-scope lines (shared by all tools and by watch mode).
2. `src/{claude,codex,gemini,qwen,agent,opencode}.prompts.lib.mjs` → `buildSystemPrompt()`: add
   two soft `When x, do y.` bullets right before the "divide and conquer" line.
3. `tests/test-issue-1887-ci-fix-prompt.mjs`: assert presence in the auto-restart prompt and all
   six system prompts.
4. `docs/case-studies/issue-1887/`: this case study + saved data.
5. Changeset (minor) to trigger the next release.

## Possible follow-ups (out of scope for #1888)

- **Option C** as a separate, well-tested feature: detect base-branch-inherited failures and, on
  detection, either (a) auto-open a scoped migration sub-PR, or (b) post a single "blocked on base
  branch — fixing repository-wide" notice and proceed to fix, rather than restarting blindly.
- Telemetry: count auto-restart iterations whose `restartReason` is unchanged across N iterations
  (a "not converging" signal) and surface it in the limit-reached comment.
