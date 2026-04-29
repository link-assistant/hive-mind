---
'@link-assistant/hive-mind': patch
---

Fix `hive` to (a) stop forwarding `false` for solve options whose `type` is
`'string'` but whose `default` is `false`, and (b) exit non-zero when any
worker fails — issue #1718.

Previously, when a user ran `/hive` against several issues, every spawned
`solve` worker crashed with:

```
Invalid --working-session-live-progress value: "false". Expected "comment" or "pr".
```

…and `hive` itself still exited with code `0`, so the Telegram bot rendered a
green "Work session finished successfully" envelope even though zero PRs had
been created.

Two independent root causes:

1. **Auto-forwarder leaked `false` as a string.** In
   [`src/hive.mjs`](./src/hive.mjs), the auto-forward block read:

   ```js
   } else if ((def.type === 'string' || def.type === 'number') && value !== undefined) {
     args.push(`--${optionName}`, String(value));
   }
   ```

   For `working-session-live-progress`, `solve.config.lib.mjs` declares
   `type: 'string', default: false`. yargs preserves the boolean `false`
   verbatim, so hive forwarded `--working-session-live-progress false`,
   which `solve` rejects. The fix adds `&& value !== false` to the
   predicate. Other `type:'string'` options whose `default` is `false`
   are now also protected by a single defense-in-depth check.

2. **No non-zero exit on worker failures.** After `monitorWithSentry()`
   resolved, hive returned without consulting `issueQueue.getStats()`. The
   fix queries `finalStats = issueQueue.getStats()` and calls
   `safeExit(1, …)` when `finalStats.failed > 0`, mirroring the exit
   semantics solve already uses. Wrappers like `start-command`, the Telegram
   bot, and CI now correctly observe the failure.

`--isolation screen` (R3 of the issue) was already wired through correctly;
no change required there. The verbose forwarder dump
(`📋 Command: ${solveCommand} ${args.join(' ')}`) — which is what allowed us
to diagnose this run in the first place — is preserved.

Tests: [`tests/test-issue-1718-hive-passthrough-false.mjs`](./tests/test-issue-1718-hive-passthrough-false.mjs)
locks the option shape, asserts both fixes are present in `src/hive.mjs`,
replays the forwarder logic on synthetic argv, and adds a defense-in-depth
sweep that no `type:'string'` / `default:false` option ever produces
`--<flag> false`.

Documentation: [`docs/case-studies/issue-1718/`](./docs/case-studies/issue-1718/README.md)
contains the timeline reconstructed from the user's `screen` log, the
distilled facts, the per-symptom root-cause analysis, the solution plan, and
notes confirming no upstream report (yargs / start-command) is required.
