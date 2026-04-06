---
'@link-assistant/hive-mind': patch
---

Fix --interactive-mode completely broken (#1532): replace promisify(execFile) with spawn-based execFileAsync that correctly pipes stdin to child processes. The Node.js promisify(execFile) silently ignores the `input` option, causing `gh api --input -` to hang forever waiting for stdin data that never arrives, which blocks the entire stream processing loop.
