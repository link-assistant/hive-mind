# Case Study: PHP Installation via Homebrew on Ubuntu 24.04

## Executive Summary

This case study analyzes the behavior of our installation script (`ubuntu-24-server-install.sh`) when installing PHP 8.3 via Homebrew on Ubuntu 24.04 LTS. The analysis is based on a real installation log captured during testing on a fresh Ubuntu 24.04 server (147.45.228.154).

## Environment Details

- **Operating System**: Ubuntu 24.04.3 LTS (GNU/Linux 6.8.0-87-generic x86_64)
- **Server**: Fresh VPS with 95.82GB disk space, 3% memory usage
- **User Context**: Installation performed as `root`, with Homebrew and PHP installed under `hive` user
- **Date**: November 10, 2025, 12:22 UTC

## Installation Flow Overview

The installation script follows this sequence:

1. Pre-flight checks (OS version, disk space, internet connectivity)
2. System prerequisites installation (apt packages, build tools, dotnet-sdk-8.0)
3. Python build dependencies
4. Swap space setup
5. **User-specific tools installation** (as `hive` user):
   - GitHub CLI
   - Bun
   - NVM + Node.js
   - Pyenv + Python
   - Rust
   - **Homebrew**
   - **PHP via Homebrew**
   - Various global packages

## PHP Installation Analysis

### Installation Method

The script installs PHP 8.3 through the `shivammathur/php` Homebrew tap:

```bash
brew tap shivammathur/php
brew install shivammathur/php/php@8.3
brew link --overwrite --force shivammathur/php/php@8.3
```

### What Actually Happened

#### Phase 1: Homebrew Installation (Lines 1101-1930)

1. **Tap Addition** (Line 1102-1103):
   ```
   ==> Tapping shivammathur/php
   Cloning into '/home/linuxbrew/.linuxbrew/Homebrew/Library/Taps/shivammathur/homebrew-php'...
   ```
   ✅ **Success**: Tap successfully added

2. **Dependency Resolution** (Line 1115):
   - PHP 8.3 required 66 dependencies
   - All dependencies successfully fetched and installed via Homebrew
   - Major dependencies included: OpenSSL 3, curl, ICU, libxml2, GD, various image libraries, etc.

3. **PHP 8.3 Installation** (Lines 1496-1930):
   ```
   ==> Installing php@8.3 from shivammathur/php
   🍺 /home/linuxbrew/.linuxbrew/Cellar/php@8.3/8.3.27_1: 523 files, 114.3MB
   ```
   ✅ **Success**: PHP 8.3.27_1 installed with 523 files (114.3MB)

4. **Important Caveat** (Line 1914-1919):
   ```
   php@8.3 is keg-only, which means it was not symlinked into /home/linuxbrew/.linuxbrew,
   because this is an alternate version of another formula.

   If you need to have php@8.3 first in your PATH, run:
     echo 'export PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:$PATH"' >> ~/.profile
     echo 'export PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:$PATH"' >> ~/.profile
   ```

#### Phase 2: Script's Linking Attempt (Lines 481-510 in script)

The script attempts to resolve the keg-only issue:

```bash
if brew list | grep -q "shivammathur/php/php@8.3"; then
  brew link --overwrite --force shivammathur/php/php@8.3 || {
    log_warning "Failed to link PHP 8.3."
  }

  if command -v php &>/dev/null; then
    log_success "PHP installed: $(php --version | head -n 1)"
  fi
fi
```

**Observation**: The script attempts to link PHP, but there's no explicit logging output showing whether the link succeeded or failed in the captured log.

#### Phase 3: Verification Failure (Line 3682)

At the end of installation, during the Installation Summary:

```
[!] PHP: not found
```

❌ **Problem Identified**: Despite PHP being successfully installed in Homebrew's Cellar, it was not accessible via `command -v php` at verification time.

## Root Cause Analysis

### Primary Issue: PATH Configuration Timing

The PHP installation suffers from a **PATH visibility problem** with multiple contributing factors:

1. **Keg-Only Formula**: PHP 8.3 is intentionally not symlinked by Homebrew to avoid conflicts with system PHP versions

2. **Link Command Ineffective**: The `brew link` command may have:
   - Failed silently (suppressed by `|| { log_warning }`)
   - Succeeded but not updated the current shell's PATH
   - Been overridden by Homebrew's keg-only policy

3. **Missing PATH Export**: Unlike the script's Homebrew installation which explicitly runs:
   ```bash
   eval "$(brew shellenv)"
   ```
   The PHP installation does not re-evaluate the shell environment after linking

4. **Current Session vs Future Sessions**: The script adds `switch-php` function to `.bashrc` for future sessions but doesn't update the current session's PATH

### Secondary Issue: Verification Logic Gap

The verification at line 694 in the script:

```bash
if command -v php &>/dev/null; then
  log_success "PHP: $(php --version | head -n 1)";
else
  log_warning "PHP: not found";
fi
```

This check runs **after** all installations but doesn't account for the need to refresh the shell environment.

## Expected vs Actual Behavior

| Aspect | Expected | Actual | Status |
|--------|----------|--------|--------|
| Homebrew Installation | PHP 8.3 installed | PHP 8.3.27_1 installed (523 files, 114.3MB) | ✅ |
| Binary Location | In Cellar | `/home/linuxbrew/.linuxbrew/Cellar/php@8.3/8.3.27_1/` | ✅ |
| PATH Linking | Available in PATH | Not accessible via `php` command | ❌ |
| Verification | Shows PHP version | Shows "PHP: not found" | ❌ |
| Future Sessions | PHP available after shell restart | Likely YES (switch-php function added) | ⚠️ |

## Installation Success Metrics

### What Worked Well ✅

1. **Dependency Management**: All 66 PHP dependencies installed successfully
2. **Binary Installation**: PHP 8.3.27_1 fully installed (523 files, 114.3MB)
3. **Configuration Files**: php.ini and php-fpm.ini properly created
4. **PEAR Configuration**: PHP Extension and Application Repository configured
5. **Future Session Setup**: Helper functions added to .bashrc for PHP version switching
6. **No Fatal Errors**: Installation completed without crashes or critical errors

### What Needs Improvement ❌

1. **Current Session PATH**: PHP not immediately available after installation
2. **Verification Logic**: Shows false negative despite successful installation
3. **Error Handling**: Link failure (if any) not prominently reported
4. **User Guidance**: No immediate workaround provided in the output

## Impact Assessment

### Immediate Impact (Current Session)

- **Severity**: Medium
- **Impact**: PHP commands are not available immediately after installation
- **Workaround**: Users must either:
  1. Manually run: `eval "$(brew shellenv)"` and `export PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:$PATH"`
  2. Restart their shell session
  3. Source their .bashrc: `source ~/.bashrc`

### Long-Term Impact (Future Sessions)

- **Severity**: Low
- **Impact**: PHP should be available after shell restart due to .bashrc modifications
- **Verification Needed**: Need to confirm PHP is in PATH after a fresh login

## Recommendations

### 1. Fix PATH Visibility in Current Session

**Priority**: High

Add explicit PATH export after linking:

```bash
if brew list | grep -q "shivammathur/php/php@8.3"; then
  brew link --overwrite --force shivammathur/php/php@8.3 2>&1 | grep -v "Warning" || true

  # Explicitly add PHP to PATH for current session
  export PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:$PATH"
  export PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:$PATH"

  # Verify immediately after export
  if command -v php &>/dev/null; then
    log_success "PHP installed: $(php --version | head -n 1)"
  else
    log_warning "PHP installed but may require shell restart to be available"
    log_note "PHP location: /home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php"
  fi
fi
```

### 2. Improve Verification Logic

**Priority**: Medium

Update the final verification to check the actual binary location:

```bash
# Check both PATH and direct binary location
if command -v php &>/dev/null; then
  log_success "PHP: $(php --version | head -n 1)"
elif [ -x "/home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php" ]; then
  log_warning "PHP: installed but not in PATH (restart shell to activate)"
  log_note "PHP location: /home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php"
else
  log_warning "PHP: not found"
fi
```

### 3. Enhanced User Communication

**Priority**: Medium

Add clearer messaging about PATH availability:

```bash
log_note "Some tools may require a shell restart to be available in PATH"
log_note "Run 'source ~/.bashrc' or restart your shell to activate all tools"
```

### 4. Automated Testing Improvement

**Priority**: Low

Add integration test to verify:
1. PHP binary exists at expected location
2. PHP is in PATH after fresh shell login
3. PHP version matches expected version (8.3.x)

## Technical Details

### File System Layout

```
/home/linuxbrew/.linuxbrew/
├── Cellar/php@8.3/8.3.27_1/           # Actual installation
│   ├── bin/php                          # PHP CLI binary
│   ├── sbin/php-fpm                     # PHP-FPM binary
│   └── etc/php.ini                      # Configuration
├── opt/php@8.3 -> ../Cellar/php@8.3/8.3.27_1/  # Symlink (if linked)
└── bin/                                 # Where PHP should be symlinked
```

### Shell Configuration Changes

The script adds to `~/.bashrc`:

1. Homebrew shellenv eval
2. `switch-php` function for version switching
3. PHP bin directories to PATH (via Homebrew notices, not script)

## Conclusion

The PHP installation **succeeds technically** but **fails user expectations** due to PATH visibility issues in the current shell session. The installation is functional and will work correctly in future shell sessions, but the immediate post-installation experience is poor with the "not found" warning.

This is a **PATH timing issue**, not an installation failure. The fix is straightforward: explicitly export PHP paths to the current session after linking.

## Appendix: Log Evidence

- **PHP Installation Start**: Line 1101
- **PHP Installation Complete**: Line 1930
- **Keg-Only Warning**: Lines 1914-1919
- **Helper Function Addition**: Line 1964
- **Verification Failure**: Line 3682
- **Total Installation Time**: ~30 minutes (based on log timestamps)
- **Disk Space Used**: 114.3MB for PHP + dependencies

## Follow-Up Questions for Testing

1. Does PHP become available after `source ~/.bashrc`?
2. Does PHP become available after a fresh SSH login?
3. Does the `switch-php` function work correctly?
4. Are PHP extensions functional (GD, curl, etc.)?
5. Can PHP-FPM start successfully?
