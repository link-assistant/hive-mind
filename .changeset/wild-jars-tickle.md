---
'@link-assistant/hive-mind': patch
---

Make a refused work session explain itself. A Formal AI sidecar (or any isolation) launch that never produced a container now logs the session UUID, backend, tool and reason to stderr instead of failing silently, keeps the UUID in the Telegram failure reply together with a sentence saying the session has no log and is not listed by `--list`, records the reason on the `session_untracked` event and in the durable session store, and is reported by `/queue` as a failed item rather than as `Finished: … (started)`. Registry pull refusals are classified, so a permanent `unauthorized`/`denied`/`not-found` escalates with remediation instead of repeating the same bland warning, and a task image that cannot be pulled falls back to a locally present one. Telegram replies also show start-command's execution UUID — the identifier `$ --list` prints — next to the session UUID, so a running or finished task can finally be found in the session list.
