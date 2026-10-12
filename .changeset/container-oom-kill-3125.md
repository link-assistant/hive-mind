---
'@link-assistant/hive-mind': patch
---

Keep tasks alive when a build fills the container's memory (#3125):

- Every AI tool, not only Codex, is now told the container memory limit and a safe build job count. It is also told that bare `make -j` and `cmake --build --parallel` start unlimited jobs.
- The commands an AI tool runs get `oom_score_adj` 500, so the kernel kills an over-limit build instead of the tool. Set `HIVE_MIND_TOOL_OOM_SCORE_ADJ=0` to turn this off.
- When the tool is killed anyway (exit code 137), the processes it left running are stopped, so a second OOM kill no longer takes solve down.
- The memory preflight reports the container's memory and swap, not the host's.
- In-place recovery runs the real `solve` command instead of the `/claude` Telegram alias, which failed with exit 127.
