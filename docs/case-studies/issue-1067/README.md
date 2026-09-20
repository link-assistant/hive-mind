# Case Study: APT Sources Duplicate Warnings in Installation Script (Issue #1067)

## Executive Summary

This case study documents an investigation into duplicate APT source warnings that appear when running the `ubuntu-24-server-install.sh` script on top of a previous installation. The investigation revealed that the warnings are caused by duplicate Microsoft Edge repository source files created during Playwright browser installation, and the script needed to implement cleanup routines to support clean upgrade scenarios.

## Issue Description

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1067

**Pull Request Reference:** https://github.com/link-assistant/hive-mind/pull/1068

**Reported Behavior:**

When running the installation script on a system where it was previously executed, the following warnings appear during `apt update`:

```
W: Target Packages (main/binary-amd64/Packages) is configured multiple times in /etc/apt/sources.list.d/microsoft-edge-stable.list:1 and /etc/apt/sources.list.d/microsoft-edge.list:3
W: Target Packages (main/binary-all/Packages) is configured multiple times in /etc/apt/sources.list.d/microsoft-edge-stable.list:1 and /etc/apt/sources.list.d/microsoft-edge.list:3
W: Target Translations (main/i18n/Translation-en) is configured multiple times in /etc/apt/sources.list.d/microsoft-edge-stable.list:1 and /etc/apt/sources.list.d/microsoft-edge.list:3
W: Target DEP-11 (main/dep11/Components-amd64.yml) is configured multiple times in /etc/apt/sources.list.d/microsoft-edge-stable.list:1 and /etc/apt/sources.list.d/microsoft-edge.list:3
W: Target DEP-11 (main/dep11/Components-all.yml) is configured multiple times in /etc/apt/sources.list.d/microsoft-edge-stable.list:1 and /etc/apt/sources.list.d/microsoft-edge.list:3
W: Target CNF (main/cnf/Commands-amd64) is configured multiple times in /etc/apt/sources.list.d/microsoft-edge-stable.list:1 and /etc/apt/sources.list.d/microsoft-edge.list:3
W: Target CNF (main/cnf/Commands-all) is configured multiple times in /etc/apt/sources.list.d/microsoft-edge-stable.list:1 and /etc/apt/sources.list.d/microsoft-edge.list:3
```

These warnings repeat multiple times throughout the script execution wherever `apt update` is called.

## Timeline of Events

Based on the issue log provided by the user:

| Event                   | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| Pre-flight checks       | Pass successfully (Ubuntu 24.04, sufficient disk space, internet connectivity) |
| User check              | `hive` user already exists (indicating previous installation)                  |
| First `apt update`      | **Warnings appear** - duplicate Microsoft Edge sources detected                |
| Package installation    | Proceeds normally despite warnings                                             |
| Playwright install-deps | **Warnings repeat** during dependency installation                             |
| Cleanup                 | **Warnings repeat** during final apt cleanup                                   |

## Root Cause Analysis

### Primary Root Cause: Duplicate APT Source Files

The system has two APT source files for Microsoft Edge:

1. `/etc/apt/sources.list.d/microsoft-edge-stable.list`
2. `/etc/apt/sources.list.d/microsoft-edge.list`

Both files contain the same repository entry, causing APT to complain about duplicate configuration.

### How the Duplicate Files Are Created

The duplicate entries can be created through several mechanisms:

1. **Multiple installation methods**: The problem arises when installing Microsoft Edge through different methods (Playwright's `install msedge`, manual installation, or different tutorials using different file names).

2. **Playwright browser installation**: When running `playwright install msedge --with-deps`, Playwright adds the Microsoft Edge repository. If Edge was previously installed by other means, this creates a duplicate.

3. **Different file naming conventions**: Various guides and installers create the repository file with different names:
   - Playwright/Microsoft installer: `microsoft-edge-stable.list`
   - Some tutorials: `microsoft-edge.list`

4. **Trailing slash differences**: Sometimes the entries differ only by a trailing slash in the URL, which APT treats as duplicate entries.

### Technical Details

From the warning message, we can see:

- `microsoft-edge-stable.list:1` - Line 1 of the stable list file
- `microsoft-edge.list:3` - Line 3 of the edge list file

This indicates both files have entries pointing to the same repository (`https://packages.microsoft.com/repos/edge stable main`).

## Evidence from Issue Log

### Duplicate Source Detection Pattern

The warnings appear every time `apt update` is called:

1. **During initial apt update** (line 20 of log)
2. **During Playwright install-deps** (line 52 of log)
3. **During final cleanup** (line 132 of log)

This confirms the issue persists throughout the script execution.

### Script Behavior Analysis

The script currently lacks:

1. **Duplicate source detection**: No check for existing duplicate APT sources before proceeding
2. **Source cleanup mechanism**: No function to remove or consolidate duplicate sources
3. **Upgrade-aware source management**: The script doesn't handle scenarios where sources were added in previous runs

## Known Related Issues

### APT Duplicate Sources

1. **[Ubuntu Mate Issue #100: Installing Microsoft Edge adds duplicate entries](https://github.com/ubuntu-mate/ubuntu-mate-welcome-legacy/issues/100)**
   - Documents how Microsoft Edge installation creates duplicate entries
   - The URL entries differ only by a trailing slash

2. **[OMG! Ubuntu: Fix "Target Configured Multiple Times" Error](https://www.omgubuntu.co.uk/2023/08/fix-target-configured-multiple-times-ubuntu)**
   - Comprehensive guide on fixing duplicate APT source entries
   - Recommends the `aptsources-cleanup` tool for automated cleanup

3. **[It's FOSS: Fixing Target Packages Configured Multiple Times](https://itsfoss.com/fixing-target-packages-configured-multiple-times/)**
   - Explains how duplicate entries accumulate from following multiple tutorials
   - Provides manual removal instructions

### Playwright Edge Installation

1. **[Playwright Issue #10695: Failed to install msedge](https://github.com/microsoft/playwright/issues/10695)**
   - Documents issues with Playwright's Edge installation on Linux
   - APT source conflicts can cause installation failures

2. **[Playwright Issue #32936: MSedge browser not installing](https://github.com/microsoft/playwright/issues/32936)**
   - Edge installation issues due to repository problems

## Impact Assessment

### Severity: Low (Warning, not Error)

The duplicate source warnings:

- **Do not prevent** the installation from completing
- **Do not affect** package management functionality
- **Are cosmetic** but indicate configuration untidiness
- **May cause confusion** for users seeing repeated warnings

### Affected Scenarios

1. Running the script for upgrade on a previously configured system
2. Systems where Edge was installed via different methods before running the script
3. Systems that have accumulated APT sources from various package installations

## Proposed Solutions

### Immediate Mitigation: Clean Duplicate Sources Before apt update

Add a function to detect and remove duplicate APT source files before running `apt update`:

```bash
# Function: cleanup duplicate APT sources for Microsoft Edge
cleanup_duplicate_apt_sources() {
  log_info "Checking for duplicate APT sources..."

  # Microsoft Edge duplicates
  if [ -f /etc/apt/sources.list.d/microsoft-edge.list ] && \
     [ -f /etc/apt/sources.list.d/microsoft-edge-stable.list ]; then
    log_info "Found duplicate Microsoft Edge APT sources, removing older file..."
    maybe_sudo rm -f /etc/apt/sources.list.d/microsoft-edge.list
    log_success "Removed duplicate Microsoft Edge source file"
  fi

  # Add similar checks for other known duplicates (Chrome, etc.) as needed
}
```

### Long-term Solution: Comprehensive Source Management

Implement a more comprehensive APT source management system:

```bash
# Function: deduplicate all APT sources
deduplicate_apt_sources() {
  log_info "Deduplicating APT sources..."

  # Find all .list files in sources.list.d
  for list_file in /etc/apt/sources.list.d/*.list; do
    [ -f "$list_file" ] || continue

    # Skip malformed files
    if ! grep -Eq "^deb " "$list_file"; then
      log_warning "Skipping malformed source file: $list_file"
      continue
    fi

    # Extract the repo URL
    repo_url=$(grep -oP 'https?://[^\s]+' "$list_file" | head -1)

    # Check for duplicates
    for other_file in /etc/apt/sources.list.d/*.list; do
      [ -f "$other_file" ] || continue
      [ "$other_file" = "$list_file" ] && continue

      if grep -q "$repo_url" "$other_file" 2>/dev/null; then
        log_info "Duplicate source found: $list_file and $other_file"
        # Keep the newer file, remove the older one
        if [ "$list_file" -ot "$other_file" ]; then
          maybe_sudo rm -f "$list_file"
          log_success "Removed older duplicate: $list_file"
          break
        fi
      fi
    done
  done
}
```

### Prevention Strategy

1. **Check before adding**: Before adding any APT source, check if a source for the same repository already exists
2. **Use consistent naming**: Standardize on one naming convention for APT source files
3. **Document upgrade behavior**: Clearly document how the script handles upgrade scenarios

## Implementation Plan

1. **Phase 1**: Add `cleanup_duplicate_apt_sources()` function to remove known duplicates
2. **Phase 2**: Call the cleanup function before every `apt update` or at the beginning of the script
3. **Phase 3**: Add upgrade mode documentation explaining the script's behavior on repeated runs
4. **Phase 4**: Consider adding a `--fix-duplicates` flag for explicit cleanup

## Recommendations

### For Users

1. **Before running the script again**, check for duplicate sources:

   ```bash
   ls -la /etc/apt/sources.list.d/*.list | grep -E "(edge|chrome)"
   ```

2. **Manual cleanup** if needed:

   ```bash
   sudo rm -f /etc/apt/sources.list.d/microsoft-edge.list
   ```

3. **After cleanup**, verify no warnings:
   ```bash
   sudo apt update 2>&1 | grep -i "configured multiple times"
   ```

### For Script Development

1. **Add proactive cleanup** at the start of the script
2. **Log cleanup actions** so users know what was changed
3. **Test upgrade scenarios** as part of CI/CD
4. **Consider using DEB822 format** (`.sources` files) instead of legacy `.list` files for better deduplication

## Conclusion

The duplicate APT source warnings are caused by multiple files referencing the same Microsoft Edge repository. This commonly occurs when:

1. Microsoft Edge is installed through different methods
2. The installation script is run multiple times (upgrade mode)
3. Playwright's browser installation adds sources that already exist

The solution is to add cleanup routines to the installation script that detect and remove duplicate source files before running `apt update`. This ensures clean installations and upgrades without warning accumulation.

## References

### Primary Issue

- [Issue #1067: Fix warnings and support upgrade mode](https://github.com/link-assistant/hive-mind/issues/1067)
- [PR #1068: Implementation of fix](https://github.com/link-assistant/hive-mind/pull/1068)

### Related Documentation

- [OMG! Ubuntu: Fix "Target Configured Multiple Times" Error](https://www.omgubuntu.co.uk/2023/08/fix-target-configured-multiple-times-ubuntu)
- [It's FOSS: Fixing Target Packages Configured Multiple Times](https://itsfoss.com/fixing-target-packages-configured-multiple-times/)
- [Ubuntu Mate Issue #100: Installing Microsoft Edge adds duplicate entries](https://github.com/ubuntu-mate/ubuntu-mate-welcome-legacy/issues/100)
- [Playwright Issue #10695: Failed to install msedge](https://github.com/microsoft/playwright/issues/10695)
- [Playwright Issue #32936: MSedge browser not installing](https://github.com/microsoft/playwright/issues/32936)

## Appendix: Original Issue Log

The full installation log from the issue is preserved in:

- `evidence/issue-1067-install-log.txt`
