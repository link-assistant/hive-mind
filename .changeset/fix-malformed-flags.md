---
'@link-assistant/hive-mind': patch
---

fix: Detect malformed flag patterns like "-- model" (Issue #1092)

Added `detectMalformedFlags()` function that catches malformed command-line options and provides helpful error messages:

- Detects "-- option" (space after --) and suggests "--option"
- Detects "-option" (single dash for long option) and suggests "--option"
- Detects "---option" (triple dash) and suggests "--option"
- Integrated into both Telegram bot and CLI argument parsing
- Added 23 comprehensive unit tests
