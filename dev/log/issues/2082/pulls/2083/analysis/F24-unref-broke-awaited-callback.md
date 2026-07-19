# F24 — A lint fix broke a test in a way only CI's Node version could see

**Severity:** High (it turned CI red) · **Class:** False negative locally — a defect the local
toolchain is structurally unable to detect
**Status:** Fixed in this PR. **Caused by this PR**, in commit `fd3a44ef`.

## Symptom

Run 29690457864 for commit `fd3a44ef`, job `test-suites`:

```
[101/340] tests/test-hive-screens.mjs
Warning: Detected unsettled top-level await at
  file:///home/runner/work/hive-mind/hive-mind/tests/test-hive-screens.mjs:295
Failed test files:
  - tests/test-hive-screens.mjs (exit 13)
```

The same file passed locally, repeatedly, before and after the change.

## Root cause

F21 enabled linting of `tests/`, which surfaced `timers/no-leaked-timers` on a fake `spawn`
helper. The rule wants the timer captured so it can be cleared. The fix applied was to
capture it and detach it:

```js
if (event === 'exit') {
  const exitTimer = setTimeout(() => cb(0), 0);
  exitTimer.unref?.(); // ← silences the rule, changes the semantics
}
```

`unref()` does not merely mark a timer as cancellable — it removes it from the set of
handles that keep the event loop alive. This callback is the one thing that settles
`await closeScreenSession('42.solve', { spawn: fakeSpawn })`. With the timer unref'd,
Node had no reason to stay alive, so it exited with that `await` still pending.

The lint rule's intent is "a timer must not outlive its purpose". `unref` satisfies the
rule's _shape_ while inverting its _intent_: the timer no longer outlives anything because
it may never run at all.

## Why local runs could not catch it

Unsettled top-level await detection, and the exit code 13 that accompanies it, landed in
Node 22. The development sandbox runs Node 20; CI pins Node 24. On Node 20 the process
simply exits 0 with the await abandoned and no diagnostic — a silent pass.

So the local suite was not merely lucky here. For this defect class it is incapable of
failing, which is the same structural shape as F21 (a lint job that could not fail over
`tests/`) and F3 (a check whose green carries no signal). The `engines` field already
requires `>=24.0.0`; the local runtime does not meet the project's own floor.

## Fix

Keep the timer referenced, and clear it from inside its own callback:

```js
if (event === 'exit') {
  const exitTimer = setTimeout(() => {
    clearTimeout(exitTimer);
    cb(0);
  }, 0);
}
```

The timer holds the loop open until it fires, `cb(0)` settles the await, and the handle is
released — satisfying `timers/no-leaked-timers` and the runtime simultaneously.

## What was checked beyond the one file

The lint pass in `fd3a44ef` touched timers in six other test files. Each was re-read
against this failure mode:

- `unref` was added in exactly **one** place — this one. No other site detaches a timer.
- The other changes add `clearTimeout` on a path that runs _after_ the awaited work
  (`await checker; await promise;`, or a `child.on('close')` handler). Clearing an
  already-fired timer is a no-op, so none of them can cancel a pending callback.

The full 340-file default suite was then re-run **under Node 24**, not the sandbox's Node
20, to exercise the detection that CI has and the sandbox lacks.

## Lesson

Two, both about the shape of evidence rather than about timers:

1. A lint autofix is a behaviour change until proven otherwise. `unref` is the clearest
   case: it is the "obvious" way to quiet the rule and it is wrong whenever anything awaits
   the callback.
2. When the local runtime is older than CI's, a local green is not weaker evidence than
   CI's — it is evidence about a different program. Verification must run on the version
   the project declares it supports.
