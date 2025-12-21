---
'@link-assistant/hive-mind': patch
---

Fix perlbrew bashrc unbound variable error at perl version check

Resolves an issue where running `perl --version` during installation would trigger an "unbound variable" error from perlbrew's bashrc file at line 71. The error occurred because:

1. The version check command triggered .bashrc sourcing in a subshell
2. Perlbrew's bashrc referenced positional parameter $1 without guards
3. With `set -u` enabled, unbound variables cause errors

**Solution:**

- Only load perlbrew in interactive shells (PS1 check in .bashrc)
- Temporarily disable `set -u` when sourcing perlbrew bashrc in the install script
- Re-enable strict mode immediately after sourcing

**Impact:**

- Eliminates confusing error messages during installation
- Maintains perlbrew functionality in interactive shells
- Preserves strict mode (`set -u`) throughout the script

**Testing:**

- Added comprehensive test script (experiments/test-perlbrew-fix.sh)
- Verified both interactive and non-interactive shell behaviors
- Confirmed strict mode is properly restored after sourcing

Fixes #954
