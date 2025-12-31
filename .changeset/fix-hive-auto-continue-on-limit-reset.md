---
'@link-assistant/hive-mind': patch
---

Add --auto-continue-on-limit-reset option to hive command

The hive command was missing the --auto-continue-on-limit-reset option that is available
in the solve command. This caused yargs strict mode to reject the option with an
"Unknown arguments" error. The option is now properly defined in hive.config.lib.mjs
and passed to the solve command when spawning workers.
