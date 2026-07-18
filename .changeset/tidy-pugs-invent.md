---
'@link-assistant/hive-mind': patch
---

Stop the Codex capability preflight from inventing requirements out of issue prose (#2077).

An image-generation issue that asked for `16:9` images aborted the whole run with
`Required Codex capability unavailable: 16:9`, because the namespaced-skill regex
accepted any `digits:digits` token and the requirement gate matched the ordinary
English word "depends".

- Capability names must now contain at least one letter, which rejects aspect
  ratios, clock times, host ports, version selectors, currency amounts and email
  addresses while staying compliant with the Agent Skills specification (a
  leading digit remains legal, so `3d-rendering` is still valid).
- An unresolvable preflight now degrades to a warning and lets Codex run with the
  operator's own capabilities instead of aborting. Set
  `HIVE_MIND_CODEX_CAPABILITY_STRICT=1` to restore the previous fail-fast
  behaviour.
- `--verbose` now prints the source line behind every accepted and rejected
  capability detection.
