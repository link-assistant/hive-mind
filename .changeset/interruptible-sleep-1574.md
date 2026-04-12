---
'@link-assistant/hive-mind': patch
---

fix: make all long sleeps interruptible so CTRL+C responds immediately (#1574)

- Replace raw `setTimeout` sleeps with an interruptible sleep utility that listens for SIGINT
- Ensure CTRL+C during CI polling, auto-merge waits, and auto-continue delays terminates the process immediately
- Add `interruptible-sleep.lib.mjs` with full test coverage
