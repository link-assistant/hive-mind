---
'@link-assistant/hive-mind': patch
---

Standardize /version output — strip OS/arch, normalize dates, enhance platform detection (Issue #1524)

- Strip OS/architecture info (e.g. x86_64-unknown-linux-gnu, linux/amd64) from version strings for cleaner output
- Normalize date formats to ISO (YYYY-MM-DD) across all version components
- Enhance platform detection for consistent environment reporting
