---
'@link-assistant/hive-mind': patch
---

The idle agentic CLI updater now takes a Bun-installed CLI's version from Bun's install list (`bun pm ls -g`) and uses `--version` only as a cross-check. claude-profiles and gh-setup-git-identity print the wrong `--version`, so every start reinstalled both and reported two failed updates even though they were already current. A disagreement is now logged once, naming the upstream bug, and is no longer counted as a failure (#2699).

Docker images build from Box 2.10.4; command-stream is pinned to 2.3.0 and lino-objects-codec is 0.9.2.
