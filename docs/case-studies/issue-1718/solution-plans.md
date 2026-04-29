# Solution plans

## SP-1 — Make `hive` exit non-zero when any worker failed (covers R1)

After `monitorWithSentry()` resolves successfully in `src/hive.mjs`, look at
`issueQueue.getStats()` and call `safeExit(1, …)` if `stats.failed > 0`.

```js
try {
  await monitorWithSentry();
  const finalStats = issueQueue.getStats();
  if (finalStats.failed > 0) {
    await safeExit(1, `${finalStats.failed} task(s) failed`);
  }
} catch (error) { … }
```

The `issueQueue` is created in `monitor()`'s scope, but the simplest fix is to
hoist it (or to expose its stats via a closure). Alternatively, propagate the
final stats back from `monitorWithSentry()`'s wrapper.

**Reuse:** `safeExit` already exists in `src/exit-handler.lib.mjs` and is the
one used by `solve` for non-zero exits — so the new behaviour mirrors solve's
exit semantics.

## SP-2 — Stop forwarding `false` for string-typed solve options (covers R2)

In `src/hive.mjs:783-804`, change:

```js
} else if ((def.type === 'string' || def.type === 'number') && value !== undefined) {
  args.push(`--${optionName}`, String(value));
}
```

to also skip when the value is the boolean `false` (the value yargs uses for
options that declare `default: false` even though their `type` is `'string'`):

```js
} else if ((def.type === 'string' || def.type === 'number') && value !== undefined && value !== false) {
  args.push(`--${optionName}`, String(value));
}
```

This is the minimum-surface-area fix:

* It does not change yargs' parsing in either `solve` or `hive`.
* It does not require fixing `solve.config.lib.mjs`'s mismatched
  `type: 'string', default: false` declarations (which would be a wider
  refactor).
* It mirrors the protective check that already exists for boolean options on
  the same loop body (which knows not to forward arbitrary values).

**Why not change `solve.config.lib.mjs` instead?** The intent of `default:
false` for `working-session-live-progress` is documented and intentional:
"opt-in feature, off by default". Changing it to `default: undefined` would
also change `solve`'s own argv shape and could ripple through tests and
downstream callers. The forwarder fix is local and safe.

## SP-3 — Pin `--isolation screen` end-to-end (covers R3)

Already implemented in `src/telegram-bot.mjs` (default
`TELEGRAM_ISOLATION='screen'`) and exercised by
`tests/test-telegram-bot-configuration-isolation-links-notation.mjs` and
`tests/test-issue-1694-stabilized-defaults.mjs`. We add a small assertion in
the new regression test that the forwarder passes `--no-tool-check` (the flag
that was used in this run) through to solve unchanged, so a regression in the
forwarder cannot silently drop other infrastructure flags either.

## SP-4 — Verbose logging of forwarded argv (covers R5)

After the auto-forwarding loop finishes (around `src/hive.mjs:805`), already
present:

```js
await log(`   📋 Command: ${solveCommand} ${args.join(' ')}`);
```

…this **is** the verbose dump that allowed us to diagnose the bug in the first
place. We will keep it. We additionally tag the forwarded values with their
type when `--verbose` is on, so the next time the auto-forwarder leaks an
unexpected value, the type mismatch is visible:

```js
if (argv.verbose) {
  await log(`   🔧 Auto-forwarded ${optionName} (${def.type}) = ${JSON.stringify(value)}`, { verbose: true });
}
```

This is gated to `verbose` mode and produces no noise in normal runs.

## SP-5 — Test that pins all of the above

Add `tests/test-issue-1718-hive-passthrough-false.mjs` that:

1. Imports `SOLVE_OPTION_DEFINITIONS` from `solve.config.lib.mjs`.
2. Asserts that any option whose `type` is `'string'` and `default` is `false`
   continues to exist (so that this test stays meaningful), then for each one
   asserts that the new forwarder logic (extracted into a tiny helper, or
   inline-replicated for the test) does **not** push it when its value is
   `false`.
3. Asserts that the forwarder still pushes string values (`'comment'`,
   `'pr'`) and number values when supplied.
4. Asserts the regression contract that `working-session-live-progress` is
   *not* in the hive-only or solve-only exclusion lists, so this entire path
   stays exercised.

## SP-6 — No upstream report needed

See [`upstream.md`](./upstream.md). The bug is internal: the option author chose
a `default` that does not match the declared `type`, and the auto-forwarder
did not guard against it. yargs is behaving exactly as documented.
