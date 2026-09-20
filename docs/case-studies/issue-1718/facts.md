# Facts (verbatim from `data/full-log.txt`)

All line numbers refer to [`data/full-log.txt`](./data/full-log.txt).

## A. The user-visible Telegram envelope says "success"

The start-command wrapper that runs `hive` inside a detached `screen` session
prints the final status JSON shown in the issue body:

```
exitCode 0
command "hive https://github.com/xlabtg/anti-corruption --model opus --all-issues --once --skip-issues-with-prs --attach-logs --verbose --no-tool-check"
```

The same fact is in the captured log at the very bottom (lines 237–239):

```
==================================================
Finished: 2026-04-29 10:27:55.620
Exit Code: 0
```

## B. Inside the same log, `hive` reports total failure (lines 226–230)

```
✅ All issues processed!
   Completed: 0
   Failed: 5
```

So the wrapper said "success" but `hive`'s own bookkeeping said "5 failed,
0 completed". The two views are inconsistent because `hive` did not call
`process.exit(1)`/`safeExit(1, …)` after seeing failures.

## C. Each `solve` invocation crashes on the same flag

The auto-generated solve command (line 113 in the log) ends with this token:

```
… --finalize 0 --working-session-live-progress false
```

`solve` then prints (lines 127–128, repeated for every worker):

```
[solve worker-1 ERROR] ❌ Invalid --working-session-live-progress value: "false". Expected "comment" or "pr".
[solve worker-1 ERROR] Use /help to see available options
```

The exact phrase is also produced by `solve.config.lib.mjs` at line 721:

```js
throw new Error(`Invalid --working-session-live-progress value: "${val}". Expected "comment" or "pr".`);
```

Five workers; five crashes; all from the same option.

## D. Isolation is already engaged

The wrapper banner at lines 4–7 confirms isolation is in effect:

```
Environment: screen
Mode: detached
Session: dc59873a-23e8-4526-ac21-06d50ecf47ee
```

So R3 ("hive uses --isolation screen") is already true; the Telegram bot adds
the `--isolation` flag itself in `telegram-isolation.lib.mjs` and routes the
hive invocation through `isolation-runner.lib.mjs` — that wiring was confirmed
in `src/telegram-bot.mjs:166-174` and is not changed by this PR.
