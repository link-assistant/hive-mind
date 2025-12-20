---
"@link-assistant/hive-mind": patch
---

Fix Perl version detection in ubuntu-24-server-install.sh

The `perlbrew available` command output was not being parsed correctly, causing the installation script to skip Perl installation with the message "Could not determine latest Perl version."

**Changes:**
- Use `grep -oE` to robustly extract Perl version strings regardless of line formatting
- Capture stderr from `perlbrew available` for better debugging
- Add debug output showing `perlbrew available` response when version detection fails
- Works with 'i' markers for already-installed versions and variable indentation

This ensures the latest Perl version is properly detected and installed via perlbrew.

Fixes #948
