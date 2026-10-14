---
'@link-assistant/hive-mind': minor
---

Cap a Docker task container to 2 CPUs once it has kept all of its CPUs busy for 15 minutes, and lift the cap after it averages below 65% of the cap for 15 minutes (issue #2801). This is on by default for `--isolation docker`. It is configurable with `--container-cpu-penalty-*` / `TELEGRAM_CONTAINER_CPU_PENALTY_*`, and `--no-container-cpu-penalty` turns it off.

Dependencies refreshed for the freshness gate: start-command 0.37.6, Formal AI 0.353.2 and `@link-assistant/agent` 0.26.13 (Docker images), and the use-m pins command-stream 2.4.0 and `@dotenvx/dotenvx` 2.35.0. The gate now checks the Formal AI pin against crates.io, the registry `cargo install` pulls it from, instead of GitHub tags: v0.353.0 was tagged but never published there.
