---
"@link-assistant/hive-mind": patch
---

Fix TTY error in ubuntu-24-server-install.sh for non-interactive contexts

When running the installation script over an already installed system or in non-interactive contexts (SSH, Docker, CI), the Deno installer was failing with "cannot open /dev/tty: No such device or address" error.

**Changes:**
- Add `-y` flag to Deno installer to skip interactive prompts
- Use `ci=true` parameter for SDKMAN installer for non-interactive mode

This ensures the installation script works reliably in automated environments.

Fixes #946
