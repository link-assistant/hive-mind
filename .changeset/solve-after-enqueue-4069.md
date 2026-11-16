---
'@link-assistant/hive-mind': minor
---

New Telegram commands `/after` and `/enqueue`, and a `--respect-blockers` option for the solve commands (issue #4069).

- `/after` and `/enqueue` start exactly one task after another task has finished. They find the task to wait for the way `/stop`, `/log` and `/watch` do: a session UUID or an issue/pull request link, in the replied message or in the command. Everything else works as in `/solve`: `/after <task-link> [options]` as a reply, `/after <uuid|awaited-link> <task-link> [options]`, or `/after [options]` as a reply to run the same link again afterwards.
- `/after` starts the task only when the awaited task succeeds (a run without changes counts as a success). When the awaited task fails, is cancelled or is killed, the waiting task fails too, and so does any chain behind it. `/enqueue` starts the task once the awaited task finishes, whatever the outcome.
- A waiting task appears in `/queue` under "Waiting for other tasks". It can be stopped with `/stop` before it starts, and joins its tool queue as an ordinary queued task once it is released.
- `--respect-blockers` (experimental, off by default; `TELEGRAM_SOLVE_RESPECT_BLOCKERS=true` turns it on for every solve command) reads the issue's GitHub relations the way `/hive` does (#2615). These are open "blocked by" issues, open sub-issues (a sub-issue blocks its parent) and the blockers of its ancestors. If every open blocker is already queued or running, the task waits for them as with `/after`. If a blocker is neither queued nor running, the task is not started. Pull requests, and issues whose relations cannot be read, start as before.
- A command with several links (#4067) now respects blockers by default (`TELEGRAM_BATCH_RESPECT_BLOCKERS`, or `--no-respect-blockers` for one command). The relations are read once, unblocked links start first, and each blocked link waits for the batch links that block it.
