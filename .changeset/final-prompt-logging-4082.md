---
'@link-assistant/hive-mind': patch
---

Every prompt sent to an AI tool is now printed in full in the log, after all formatting, as a clearly marked block (PR #4083 review feedback on issue #4082).

- Claude, Codex, Agent, OpenCode, Gemini, Qwen, agent-commander, the task command and the /organize classifier log the exact user, system or combined prompt where it is sent. Each block shows its line and character count and how the prompt is delivered (argument, file, stdin or stream-json frame), and sits between `---BEGIN … PROMPT---` and `---END … PROMPT---` markers. This happens on every run, not only with `--dry-run` or `--verbose`.
- Live input frames written to the tool stdin mid-session (forwarded comments, status updates, queued frames) are printed as readable text in `LIVE INPUT PROMPT` blocks.
- The /organize classifier receives its repository context and issues as indented JSON instead of one long line. Chunk sizes are measured on that formatted text.
