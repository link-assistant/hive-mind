---
'@link-assistant/hive-mind': minor
---

Cap a Docker task container to 2 CPUs once it has kept all of its CPUs busy for 15 minutes, and lift the cap after it averages below 65% of the cap for 15 minutes (issue #2801). This is on by default for `--isolation docker`. It is configurable with `--container-cpu-penalty-*` / `TELEGRAM_CONTAINER_CPU_PENALTY_*`, and `--no-container-cpu-penalty` turns it off.
