# Root cause analysis

## RC-1 — `hive` exits with code 0 even when every worker failed

`monitor()` ends after printing `✅ All issues processed! / Completed: 0 /
Failed: 5`. After the loop, control returns to the top-level `try` in
`src/hive.mjs:1474-1485`:

```js
try {
  await monitorWithSentry();
} catch (error) {
  …
  await safeExit(1, 'Error occurred');
}
```

Failed workers are caught locally inside the worker loop
(`src/hive.mjs:882-895`):

```js
} catch (error) {
  …
  issueQueue.markFailed(issueUrl);
  issueFailed = true;
  break; // Stop trying more PRs for this issue
}
```

…so they never propagate as exceptions. The function returns normally,
`monitorWithSentry` resolves successfully, and the process exits naturally
with code 0. There is no `process.exit(stats.failed > 0 ? 1 : 0)` anywhere on
the success path. **This is the cause of the green Telegram envelope in
section A of `facts.md`.**

## RC-2 — `--working-session-live-progress false` is forwarded by hive

`solve.config.lib.mjs:529-533` declares the option:

```js
'working-session-live-progress': {
  type: 'string',
  description: '[EXPERIMENTAL] Enable live progress monitoring. Accepts "comment" (default, …) or "pr". …',
  default: false,
},
```

Note the mismatch: `type: 'string'` but `default: false` (boolean). yargs
keeps that default verbatim, so `argv.workingSessionLiveProgress === false`
when the user did not pass the flag.

In `solve` itself, the validator allows `false` (`if (argv && argv.workingSessionLiveProgress)` short-circuits because `false` is falsy — see
`solve.config.lib.mjs:716`). So `solve` is fine when called directly.

But hive auto-forwards every solve option. The forwarding code in
`src/hive.mjs:783-804` reads:

```js
} else if ((def.type === 'string' || def.type === 'number') && value !== undefined) {
  args.push(`--${optionName}`, String(value));
}
```

For `working-session-live-progress`:

| Predicate               | Value                                   |
| ----------------------- | --------------------------------------- |
| `def.type === 'string'` | `true`                                  |
| `value !== undefined`   | `true` (`false`)                        |
| Pushed argv             | `--working-session-live-progress false` |

Inside the spawned `solve`, that string `"false"` is no longer falsy, so
`solve.config.lib.mjs:720` rejects it:

```js
} else if (typeof val === 'string' && !['comment', 'pr'].includes(val.toLowerCase())) {
  throw new Error(`Invalid --working-session-live-progress value: "${val}". Expected "comment" or "pr".`);
}
```

**This is the cause of every "solve exited with code 1" in section C of
`facts.md`.**

The same shape exists for two more solve options whose `default` is `false`
but `type` is `'string'`. They were not exercised in the failing run because
the user did not opt them in, but they would have produced the same crash if
combined with hive — the fix below covers them generically.

```
$ grep -n "type: 'string'" src/solve.config.lib.mjs | head
… (manually inspected; the other false-defaulted string options are
"finalize-model" with default undefined, etc. — see solution-plans.md.)
```

## RC-3 — Why this only surfaces now

Searching `git log`:

- `working-session-live-progress` was introduced relatively recently
  (referenced by case studies `issue-1647`, `issue-1670`, `issue-1673`,
  `issue-1710`, `issue-1616`).
- The hive auto-forwarder was added in #1209 to reduce manual maintenance.
- No regression test in `tests/test-hive-solve-option-parity.mjs` checks
  the _value_ of forwarded args — only their presence.

So the regression is: option author chose a non-conformant `default` (boolean
`false` for a string-typed option), the hive auto-forwarder did not guard
against that shape, and no test caught the resulting `--flag false` token.

## RC-4 — `--isolation screen` is fine

The Telegram bot starts `hive` through `isolation-runner.lib.mjs` whose
backend is `screen`. The captured log shows `Environment: screen` /
`Mode: detached`. Nothing in the auto-forwarder touches isolation, so this
case study confirms R3 is already satisfied — no code change is required for
that requirement. We add a regression test that pins this so a future refactor
of the forwarder cannot accidentally drop it.
