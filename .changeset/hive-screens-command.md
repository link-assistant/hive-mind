---
'@link-assistant/hive-mind': minor
---

Add `hive-screens` bin command. Converts the `hive-screens.sh` script that was
embedded in README.md into a real JavaScript command shipped with the package.
Supports `--list` (safe preview), `--enter` (attach), and `--close` (terminate)
across detached GNU screen sessions that completed a mergeable solve run.
`--list`, `--enter`, and `--close` share the same matching predicate, so any
session visible under `--list` is guaranteed to be actionable by the other
flags. Selection flags `--oldest` (default), `--newest`, and `--all` are
preserved from the legacy script. Closes #1649.
