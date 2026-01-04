---
'@link-assistant/hive-mind': major
---

Rename `--auto-continue-on-limit-reset` to `--auto-resume-on-limit-reset` for clarity

BREAKING CHANGE: The `--auto-continue-on-limit-reset` option has been renamed to `--auto-resume-on-limit-reset`. Users must update their commands and configurations to use the new flag name.

The option is related to `--resume` for `claude` command and has an entirely different meaning from `--auto-continue` mode. This rename makes the distinction clearer and aligns the terminology with the resume functionality.

Migration:

- Replace `--auto-continue-on-limit-reset` with `--auto-resume-on-limit-reset` in all commands
- Update environment variables and configuration files accordingly
