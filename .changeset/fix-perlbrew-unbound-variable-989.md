---
'@link-assistant/hive-mind': patch
---

Fix perlbrew bashrc unbound variable error (issue #989)

**Problem:** The error `/home/hive/perl5/perlbrew/etc/bashrc: line 71: $1: unbound variable` appeared during Docker builds when running Perl version checks.

**Root Cause:** Perlbrew's generated bashrc uses positional parameter `$1` and other variables without protection against `set -u` (nounset mode).

**Solution:**

- Patch perlbrew bashrc after installation to use `${1:-}`, `${PERLBREW_LIB:-}`, and `${outsep:-}` syntax
- Add CI check to detect and fail on any unbound variable errors in Docker builds
- Add case study documentation for future reference

**Changes:**

- `scripts/ubuntu-24-server-install.sh`: Patch perlbrew bashrc for set -u compatibility
- `.github/workflows/release.yml`: Add CI check for unbound variable errors
- `docs/case-studies/issue-989/`: Add case study documentation

References:

- Issue: https://github.com/link-assistant/hive-mind/issues/989
- Upstream fix: https://github.com/gugod/App-perlbrew/pull/850
