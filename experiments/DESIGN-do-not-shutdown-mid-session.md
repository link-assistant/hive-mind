# Design: `--do-not-shutdown-in-the-middle-of-working-session` (issue #1823, PR #1824)

## Validated facts (see experiments/command-stream-signals.mjs)

- command-stream installs **only** a `process.on('SIGINT')` handler. It has **no SIGTERM handler**.
- On SIGINT, command-stream forwards SIGINT to its active child's process group
  (`process.kill(-childPid, 'SIGINT')`), killing the AI child mid-run. It calls
  `process.exit(130)` **only when no other SIGINT handler exists**; with another handler present
  (solve's exit-handler), it just kills the child and returns.
- hive spawns solve with `detached: true` → solve is its own process-group leader.
- command-stream spawns the AI child with `detached: true` → the AI child is **its own** group
  leader, in a **separate** group from solve. So signalling solve's group never reaches the AI
  child, and vice-versa. (This is why the pre-existing `forceKillActiveSolveChildren(-solvePid)`
  could not actually reach the codex/claude child — a latent gap this work also addresses.)

## Concept

"AI working session" = the window during which the AI tool child (claude/codex/gemini/opencode/
qwen/agent) is actively running/streaming. New experimental flag
`--do-not-shutdown-in-the-middle-of-working-session` (default `false`).

## Wire signal: hive → solve uses **SIGTERM**

hive forwards the operator's CTRL+C intent to each in-flight solve by sending **SIGTERM to the
solve process** (not its group). Rationale: command-stream ignores SIGTERM, so the AI child is
never collaterally killed by the library; solve's own (session-aware) handler decides what to do.
This is the robust way to "send CTRL+C to solve" without command-stream aborting the AI mid-turn.

## Behavior matrix

| Context          | Flag          | Signal                           | Behavior                                                                                     |
| ---------------- | ------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| standalone solve | off (default) | SIGINT (CTRL+C)                  | UNCHANGED: command-stream kills AI child, exit-handler auto-commits + exits 130              |
| standalone solve | off           | SIGTERM                          | exit-handler now **also auto-commits** (bug-fix), exits 143                                  |
| hive → solve     | on            | SIGTERM (1st) during AI session  | DEFER: record shutdown request, log, let AI session finish; then auto-commit + graceful exit |
| hive → solve     | on            | SIGTERM (1st) while idle/CI-wait | STOP NOW: break interruptibleSleep, auto-commit, exit                                        |
| hive → solve     | on            | 2nd signal                       | FORCE: kill AI child group + auto-commit + exit 130                                          |
| standalone solve | on            | SIGINT/CTRL+C                    | same as hive path (command-stream SIGINT neutralized during protected session)               |

## Components

1. **src/working-session.lib.mjs** (new): module state + API:
   `configureWorkingSession({enabled,log})`, `beginWorkingSession()`, `endWorkingSession()`,
   `isWorkingSessionActive()`, `isFlagEnabled()`, `requestShutdown(signal)` →
   `{first:boolean}`, `isShutdownRequested()`, `getShutdownSignal()`, plus command-stream
   SIGINT neutralize/force helpers (`neutralizeCommandStreamSigint`, `forceKillActiveChildren`).
2. **src/solve.config.lib.mjs**: add boolean option (default false). Auto-forwarded by hive via
   SOLVE_OPTION_DEFINITIONS (no hive.mjs option-list change needed).
3. **src/solve.mjs**: `configureWorkingSession` at startup; wrap the AI dispatch (705-814) with
   `beginWorkingSession()`/`endWorkingSession()`; after the session, if shutdown was requested,
   auto-commit (already done by interrupt path) and `safeExit`.
4. **src/exit-handler.lib.mjs**: make SIGINT + SIGTERM handlers session-aware:
   - protected session active + flag: 1st signal → `requestShutdown` + log (defer, no exit);
     2nd → force-kill AI child + interrupt(auto-commit) + exit 130.
   - otherwise: SIGINT unchanged; SIGTERM now runs interrupt(auto-commit) too.
5. **src/interruptible-sleep.lib.mjs**: also resolve early on SIGTERM (idle/CI-wait paths must be
   immediately interruptible by the forwarded signal).
6. **src/hive.mjs / hive.shutdown.lib.mjs**: on 1st interrupt, send SIGTERM to each in-flight
   solve **process** (forward CTRL+C) instead of only waiting; still wait for workers to finish.
   On 2nd interrupt, force-kill (escalate).

## Backwards compatibility

With the flag OFF (every existing invocation except hive), solve's SIGINT path is byte-for-byte
unchanged. The only added behavior is auto-commit on SIGTERM (a welcomed bug-fix per the issue).
