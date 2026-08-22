# F22 — `CLAUDE_CODE_EFFORT_LEVEL` leaked from the parent shell into the child Claude process

**Severity:** High · **Class:** Product bug, plus a test that returned opposite verdicts in CI and locally

Found by enabling the `tests/` lint glob (F21) and then running the full default suite —
which had, it turned out, never been run in an environment resembling the one hive-mind's
own agents run in.

## Symptom

`tests/test-opus-47-model-support.mjs` fails with 5 errors when run locally, and passes in
CI. Same commit, opposite verdicts:

```
haiku (4.5) + --think off: lowest effort when adaptive
 Error: Expected values to be strictly equal:
+ actual - expected
+ 'low'
- undefined
```

The first hypothesis — a Node version mismatch, since the sandbox runs Node 20 and CI
pins Node 24 — was wrong. The behaviour is deterministic and reproduces on both.

## Root cause

`getClaudeEnv()` builds the child environment by spreading the parent's:

```js
const env = buildClaudeQuietEnv({ ...process.env /* ... */ });
```

For adaptive-thinking-only models it then explicitly sanitises one inherited variable:

```js
if (adaptiveThinkingOnly) {
  // Remove any inherited MAX_THINKING_TOKENS from process.env — these models ignore it
  delete env.MAX_THINKING_TOKENS;
}
```

Nothing did the same for `CLAUDE_CODE_EFFORT_LEVEL`. The block below it only ever
_assigns_:

```js
if (options.model && supportsEffortLevel(options.model)) {
  ...
  if (effortLevel) env.CLAUDE_CODE_EFFORT_LEVEL = effortLevel;
  else if (options.thinkLevel === 'off' && adaptiveThinkingOnly) env.CLAUDE_CODE_EFFORT_LEVEL = 'low';
}
```

So on **every path that does not compute a level**, the parent's value survives:

- a model that supports no effort levels at all (`haiku`) — the outer `if` is skipped entirely;
- `--think off` on a non-adaptive model — neither inner branch fires.

Claude Code exports `CLAUDE_CODE_EFFORT_LEVEL`, and hive-mind's agents run under Claude
Code. So the leak fired in the ordinary case, not a corner case:

```
$ CLAUDE_CODE_EFFORT_LEVEL=max node -e "getClaudeEnv({model:'haiku', thinkLevel:'high'})"
haiku (no effort support), --think high: "max"      # ← inherited
opus-4-6 --think off:                    "max"      # ← inherited, thinking is off
```

`haiku` was being handed `effort=max` for a model the codebase itself classifies as
supporting no effort levels.

## Why CI never saw it

CI runs without `CLAUDE_CODE_EFFORT_LEVEL` set, so the spread contributes nothing and the
test passes. The variable is present only in the environment where the project's own
agents work. The test suite was therefore green on the machine that could not exercise the
bug, and red on the machine that could — and the local red was easy to dismiss as "my
environment is odd", which is precisely what makes this class of finding durable.

## Fix

Mirror the existing `MAX_THINKING_TOKENS` sanitisation — delete the inherited value before
the assignment logic, so the emitted level is a function of the selected model and think
level and never of the ambient shell.

`tests/effort-level-env-leak-2082.test.mjs` pins both the leak and the behaviour that had
to survive the sanitisation (issue #2032's lowest-effort mapping for adaptive-only models
on `--think off`, and computed levels still winning). Its final case asserts the general
invariant directly: for a set of model/think-level pairs, the result is identical whether
or not the parent exports the variable.

Mutation-checked: removing the `delete` makes the test fail with
_"a model with no effort-level support must not inherit one from the parent shell"_.

After the fix, `test-opus-47-model-support.mjs` passes **166/0 under a polluted
environment as well as a clean one** — it is no longer environment-dependent.

## Related, not fixed here

Three further variables in the same `getClaudeEnv` block follow the identical
`if (options.X) env.Y = ...` shape and are **also exported by Claude Code**, so they leak
the same way:

| Variable                          | Value observed in the agent environment |
| --------------------------------- | --------------------------------------- |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT`  | `1`                                     |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `150000`                                |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `95`                                    |

`CLAUDE_CODE_DISABLE_1M_CONTEXT=1` is the notable one: a child inherits it even when
`--disable-1m-context` was not passed, which would silently contradict the per-model
`supports1mContext` logic.

These are **deliberately left unchanged**. Unlike the effort level, they have no existing
sanitisation precedent in the function, no failing test demonstrates a wrong outcome, and
a user may well export them intentionally as global configuration. Stripping them is a
behaviour change that deserves its own decision rather than being folded into this fix.
Recommended follow-up: decide explicitly, per variable, whether hive-mind's flags own it
or the ambient environment does, and document the answer.
