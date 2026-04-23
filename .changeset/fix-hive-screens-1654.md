---
'@link-assistant/hive-mind': patch
---

fix(hive-screens): make `--list` default to `--all`, print log/issue after `--enter` exits, and actually close sessions on `--close`

Addresses issue #1654:

- `hive-screens --list` now defaults to `--all` so a bare `--list` lists every
  match, matching user expectations. `--enter` and `--close` keep `--oldest` as
  their default because they are destructive.
- `hive-screens --enter` now prints `Log:` and `Issue:` lines **after** the
  user detaches from the screen session, so the information is not wiped by
  `screen -r` swapping to the alternate buffer.
- `hive-screens --close` now spawns `screen -X stuff exit\n` directly (with
  the newline as a literal argv element) instead of shelling out with bash
  ANSI-C quoting (`$'exit\n'`). The legacy form relied on `/bin/sh` being
  bash, but on Debian/Ubuntu it is `dash`, which does not understand
  `$'...'` — so the previous command sent the literal string `$exit\n` into
  each session and never actually closed it.
- Adds a `--verbose` / `-v` flag that prints scanning diagnostics to stderr.
