---
'@link-assistant/hive-mind': patch
---

`--auto-restart-until-mergeable` no longer reports "✅ Ready to merge" over open review findings, and the task image can run corepack-based git hooks again (issue #4082).

- Unresolved review threads are listed in the AI's feedback whatever their age or author, review bots included. Before, only comments newer than the last commit counted. The watch loop restarts the AI on each thread it has not handed over yet. Threads the AI was given but left unresolved hold "Ready to merge" back and are named in the comment. The prompt tells the AI to resolve each thread after a verified fix.
- Submitted reviews are read too: a bot review that requests changes, a human review, or a same-account comment without tool markers restarts the AI.
- Merge-order prerequisites declared in the pull request description or the latest session summary ("merge the companion PR first", "Depends on owner/repo#12") are checked on GitHub. While one is unmet, "Ready to merge" becomes "🟡 Ready for review — blocked by …", and auto-merge does not merge.
- After "Ready to merge" the loop keeps watching for late reviews for `--auto-restart-until-mergeable-review-window-minutes` (default 120; `0` exits at once). New options: `--auto-restart-on-unresolved-review-threads` and `--check-merge-prerequisites`, both on by default.
- The Docker images install a pinned `corepack`, which Node 26 no longer bundles. Solve also tells the AI when a repository's git hooks cannot run here (a missing corepack, pnpm, yarn, pre-commit, lefthook, …), so their checks are run by hand instead of being skipped silently.

Every prompt sent to an AI tool is now printed in full in the log, after all formatting, as a clearly marked block (PR #4083 review feedback on issue #4082).

- Claude, Codex, Agent, OpenCode, Gemini, Qwen, agent-commander, the task command and the /organize classifier log the exact user, system or combined prompt where it is sent. Each block shows its line and character count and how the prompt is delivered (argument, file, stdin or stream-json frame), and sits between `---BEGIN … PROMPT---` and `---END … PROMPT---` markers. This happens on every run, not only with `--dry-run` or `--verbose`.
- Live input frames written to the tool stdin mid-session (forwarded comments, status updates, queued frames) are printed as readable text in `LIVE INPUT PROMPT` blocks.
- The /organize classifier receives its repository context and issues as indented JSON instead of one long line. Chunk sizes are measured on that formatted text.
