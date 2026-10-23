# Case study: issues #744 and #733, an AI session ran `pkill -9 node` and killed the bot

- Issues: https://github.com/link-assistant/hive-mind/issues/744 and
  https://github.com/link-assistant/hive-mind/issues/733
- Issue text, the Claude session log and the bot log:
  [data/issue-744.md](./data/issue-744.md) and
  [data/issue-733.md](./data/issue-733.md)

## Summary

On 2025-11-14 a `/solve` session started from the Telegram bot worked on a
web-capture pull request. Its local test server failed to start with
`EADDRINUSE` on port 3456. Claude (`claude-sonnet-4-5-20250929`) said "Port is
still in use. Let me kill all node processes and start fresh." and ran
`pkill -9 node`. The session ran in `screen` on the host as the same user as the
bot, so the command sent SIGKILL to every Node.js process of that user: the
Telegram bot, the other running `solve` sessions and the Claude CLI running the
session itself. The bot's terminal printed `Killed`.

Issue #733 ("hive-telegram-bot killed") is the same incident seen from the bot's
terminal. The maintainer confirmed this on 2025-11-15: "#733 was actually caused
by this issue."

## Timeline (UTC)

| Time                | Event                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2025-11-14 18:56:10 | Work dir `gh-issue-solver-1763146570272` is created (its millisecond timestamp); the last bot log line of #733 starts `start-screen solve .../web-capture/pull/18` |
| later               | Claude restarts its test server: `kill $(cat /tmp/server.pid) 2>/dev/null ; ... PORT=3456 node src/index.js &`                                                     |
| next step           | `/tmp/manual-server2.log` shows `listen EADDRINUSE: address already in use :::3456`: the old server still held the port, or the PID file was stale                 |
| next step           | "Port is still in use. Let me kill all node processes and start fresh." followed by `pkill -9 node ; sleep 2 && ... PORT=3456 node src/index.js &`                 |
| immediately         | The bot gets SIGKILL; its terminal prints `Killed` and returns to the `hive@...:~$` prompt (#733, #744)                                                            |
| 2025-11-14 19:40    | First #733 analysis (unmerged commit a4c70924f) blames the `YError` stack traces in the bot log                                                                    |
| 2025-11-15 09:33    | First #744 analysis (unmerged commit 35855c304) reconstructs the session from the Claude JSON log                                                                  |
| 2025-11-15 12:25    | The maintainer links #733 to #744                                                                                                                                  |
| 2026-03-31          | `--isolation` (screen/tmux/docker) is added to the bot (2e9932cca)                                                                                                 |
| 2026-06-25          | The bot defaults to `--isolation docker` (`TELEGRAM_ISOLATION`, 4d65c055f)                                                                                         |

## Requirements and status

| #   | Requirement                                                                                      | Status                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | #744: research how to reduce the probability of the AI tool killing itself, the bot and the rest | Done: this document. Isolation is the main protection; three extra guards are added for the cases without it (below).                                 |
| 2   | #744: reduce that probability in code                                                            | Done: the prompt rule for all six tools, the Claude deny rules and the bot process title.                                                             |
| 3   | #733: find out why the bot was killed                                                            | Done: it was the `pkill -9 node` of #744, not the `YError` traces (see "Correction of the first #733 analysis").                                      |
| 4   | #733 and #744: collect the logs and data into `docs/case-studies` and write a case study         | Done: `data/issue-744.md` (Claude session log), `data/issue-733.md` (bot log) and this document.                                                      |
| 5   | Report upstream issues where they exist                                                          | Nothing to report: `pkill` and the tool CLIs behave as documented. One documentation question for Claude Code is listed under "Upstream" (not filed). |

## Root causes

1. **No process isolation.** The session ran on the host, as the bot's user, in
   the bot's PID namespace. `pkill` matches process names, so `pkill node` hit
   every Node.js process the user could signal. The bot, the other sessions and
   the Claude CLI were all named `node`.
2. **An escalation the prompt did not forbid.** The targeted restart (by PID
   file) was right. When it failed, the model did not look up the port owner
   (`lsof -i :3456`) or pick another port. It escalated to a system-wide kill.
   Nothing in the system prompt said that other processes share the machine.
3. **Nothing blocked the command.** Claude ran with
   `--dangerously-skip-permissions` and no deny rules for process-kill commands.

### Correction of the first #733 analysis

The first #733 analysis (a4c70924f) blamed the
`YError: Not enough arguments provided` stack traces. That is wrong. In the #733
log the bot logs each `YError` and then goes on to run `start-screen solve ...`
for the same command, so the error is caught and does not stop the bot. The
process ends after it starts the web-capture session, with the shell message
`Killed` (SIGKILL), which is the `pkill -9 node` from #744. The `YError` noise
was a separate, harmless problem in the argument validation.

## Solutions

### Main protection: Docker isolation (the default)

Since 2026-06-25 the Telegram bot runs every work session with
`--isolation docker` (`TELEGRAM_ISOLATION`, default `docker`). The session runs
in its own container with its own PID namespace. There, `pkill -9 node` only
reaches the processes in that container; the bot, the other sessions and the
host are out of reach.

The guards below only reduce the chance of the same mistake when isolation is
off, for example:

- `--isolation ''`, `TELEGRAM_ISOLATION=''`, or `screen`/`tmux` isolation;
- `solve` or `hive` run by hand on the host (these CLIs do not default to Docker
  isolation);
- several processes sharing one container.

### Added guards (defense in depth)

- **A prompt rule in every tool's system prompt** (claude, codex, agent,
  opencode, gemini, qwen): a "Process safety." section from
  `src/process-safety.prompts.lib.mjs`, appended after the issue-completion
  section. Stop only the processes you started, by the recorded PID. Never run
  `pkill node`, a broad `pkill -f`, `killall`, `kill -9 -1` or `kill 0`. When a
  port is busy, find its owner with `lsof -i :PORT` or `ss -ltnp`, and use
  another port if that process is not yours.
- **Claude deny rules** `Bash(pkill:*)` and `Bash(killall:*)`
  (`PROCESS_KILL_DENY_RULES` in `src/useless-tools.lib.mjs`). They are passed on
  every Claude session's `--disallowedTools`, also when the useless-tools list
  is turned off. `src/claude.lib.mjs` shell-quotes each entry, so `*` and `(`
  are neither globbed nor split by a shell.
- **A distinct bot process name.** `src/telegram-bot.mjs` sets
  `process.title = 'hive-telegram-bot'` right after its imports. On Linux this
  replaces both the comm name (`hive-telegram-b`, 15 characters) and the
  cmdline, so `pkill node`, `pkill -f node` and `killall node` no longer match
  the bot. `pgrep -f hive-telegram-bot` finds it. A side effect: `ps` shows
  only `hive-telegram-bot`, without the command-line options (which also keeps a
  `--token` value out of `ps`).

## Tests

`tests/issue-744-process-kill-guard.test.mjs` (11 tests, hermetic):

- each of the six `buildSystemPrompt` results contains the rule exactly once,
  with the PID, broad-kill and port-owner sentences;
- `PROCESS_KILL_DENY_RULES` is frozen and is not part of the settings.json
  useless-tools list;
- Claude sessions get the deny rules with the default options, with useless
  tools enabled and without Playwright MCP;
- `claude.lib.mjs` quotes the `--disallowedTools` entries;
- `telegram-bot.mjs` sets the title in its first 15 lines;
- on Linux, a real child process with that title has
  `/proc/<pid>/comm = hive-telegram-b` and a cmdline without `node`.

`tests/useless-tools.test.mjs` was updated for the two extra entries.

## Limits

- The deny rules are prefix rules for the Bash tool. They do not catch
  `sudo pkill`, `sh -c 'pkill node'`, `kill -9 -1`, `kill 0`, `xargs kill` or a
  script that kills processes. They exist for Claude only: Codex, OpenCode,
  Agent, Gemini and Qwen have no equivalent, so for them the prompt rule is the
  only extra guard.
- Checked against a live Claude Code 2.1.306 session
  (`claude -p --dangerously-skip-permissions --disallowedTools 'Bash(pkill:*)' 'Bash(killall:*)'`):
  - `pkill -f <pattern> ; echo done` was refused ("Permission to use Bash with
    command pkill … has been denied"). The deny rules do apply in
    `bypassPermissions` mode, even inside a compound command.
  - `bash -c 'pkill -f <pattern>; echo inner-done'` was allowed
    (`permission_decision: accept, reason_type: mode`). Its `pkill -f` matched
    the Claude CLI's own command line, which contained the pattern, and killed
    the run with exit 137. That is the #744 failure mode in miniature: a shell
    wrapper gets past the prefix rule, and `pkill -f` matches more than the
    author meant. Docker isolation is the guard that holds here.
- The resume commands shown to users (`src/claude.command-builder.lib.mjs`) do
  not carry the deny rules; a manual resume relies on the prompt rule and on
  isolation.
- The process title protects the bot only. The other sessions and the tool CLIs
  are still named `node` (or `claude`, `codex`) and can still be killed without
  isolation. `kill -9 -1` kills every process of the user, whatever its name.
- A prompt rule lowers the probability. It is not a guarantee.

## Upstream

No bug to report: `pkill` and the tool CLIs behave as documented, and the fix is
isolation on our side. The open question about Claude Code was answered by the
live check under "Limits": deny rules apply under
`--dangerously-skip-permissions`. They are prefix rules, and Claude Code does
not look inside a `bash -c` wrapper. That is documented behaviour: the
[permissions docs](https://code.claude.com/docs/en/permissions) say a Bash deny
rule "covers the invocation Claude usually produces and isn't a security boundary
around the program", and give `bash -c 'rm -rf build/'` as a form that `Bash(rm *)`
does not stop. Nothing was filed.
