---
'@link-assistant/hive-mind': patch
---

Fix false CI signals found in #4029:

- **Red `Checks and release` on main.** The capability lifecycle gate now accepts the typed refusal of an unpinned npm-latest Codex (0.167.0 ships different stock skills than the pinned 0.164.0). It then restores the pinned stock runtime before the next phases.
- **Docker checks.** Image-gate helpers mounted into the container now trigger them.
- **Freshness gate.** azure/setup-helm v5.1.0 and lino-objects-codec 0.9.6 keep it green.
- **Formal AI Draft.** Dispatched checks are no longer left `pending` forever: the reporter waits up to 200 minutes and then posts a terminal status.
- **Cleanup.** The log explains why the stale branch count exceeds the fixture count.
- **Noise.** Every workflow that checks out sets `init.defaultBranch`, which removes the `git init` hints. ShellCheck runs from a pinned venv instead of `pipx run`, which removes the PATH warning.
