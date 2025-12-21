# Case Study: Issue #946 - Error in scripts/ubuntu-24-server-install.sh

## Summary

When running `scripts/ubuntu-24-server-install.sh` over an already installed hive-mind system, users encounter the error:
```
sh: 105: cannot open /dev/tty: No such device or address
```

This error occurs during the Deno installation phase.

## Timeline of Events

1. **User runs installation script** on an already configured system
2. **Script reaches Deno installation** (line 476 in `hive-user-setup.sh` embedded within the main script)
3. **Deno installer attempts interactive prompt** for shell configuration
4. **Installer fails** with `/dev/tty` error because the script runs in a non-interactive context (via `su -` or piped execution)

## Root Cause Analysis

### Primary Issue: Deno Install Script TTY Requirement

The Deno install script (`https://deno.land/install.sh`) contains the following logic (around line 105):

```bash
if [ -t 0 ]; then
    run_shell_setup "$@"
else
    # This script is probably running piped into sh, so we don't have direct access to stdin.
    # Instead, explicitly connect /dev/tty to stdin
    run_shell_setup "$@" </dev/tty
fi
```

When the installer detects that stdin is not a TTY (because it's piped via `curl | sh`), it attempts to read from `/dev/tty` directly to enable interactive prompts. However, when running:
- Via `su - hive -c "bash script.sh"` (as in our installation script)
- In a non-interactive SSH session
- In a Docker container without a TTY attached
- In CI/CD pipelines

The `/dev/tty` device is not available, causing the error.

### Secondary Issue: SDKMAN May Have Similar Problems

The SDKMAN installer also requires interactive input by default, though it handles this more gracefully than Deno.

## Solution

### Fix 1: Deno Installation (Primary)

Use the `-y` flag to skip interactive prompts:

```bash
# Before (problematic):
curl -fsSL https://deno.land/install.sh | sh

# After (fixed):
curl -fsSL https://deno.land/install.sh | sh -s -- -y
```

The `-y` / `--yes` flag tells the Deno installer to:
- Accept all defaults
- Skip the "Edit shell configs to add deno to the PATH?" prompt
- Not attempt to read from `/dev/tty`

### Fix 2: SDKMAN Installation (Preventive)

Although not reported as failing, update SDKMAN to use CI mode for consistency:

```bash
# Before:
curl -s "https://get.sdkman.io?rcupdate=false" | bash

# After:
curl -s "https://get.sdkman.io?rcupdate=false&ci=true" | bash
```

The `ci=true` parameter:
- Sets `sdkman_auto_answer=true` (answers all prompts automatically)
- Sets `sdkman_colour_enable=false` (cleaner logs)
- Sets `sdkman_selfupdate_feature=false` (prevents unexpected updates)

## Affected Code Locations

1. **scripts/ubuntu-24-server-install.sh:476** - Deno installation
2. **scripts/ubuntu-24-server-install.sh:652** - SDKMAN installation

## Evidence

### Error Log from Issue
```
Installing Bun..
100.
bun was installed successfully to —/.bun/bin/bun
...
Installing Deno.
100.
Archive:
/home/hive/ . deno/bin/deno. zip
inflating: /home/hive/ .deno/bin/deno
Deno was installed successfully to /home/hive/ .deno/bin/deno
sh: 105: cannot open /dev/tty: No such device or address
```

### Deno Install Script Source
- Repository: https://github.com/denoland/deno_install
- Relevant code: https://github.com/denoland/deno_install/blob/master/install.sh

### Related Issues/Resources
- Deno improvements for installation: https://github.com/denoland/deno/issues/24157
- Remote installation issues: https://github.com/denoland/deno/issues/25931
- SDKMAN CI mode: https://sdkman.io/install/

## Testing

The fix can be tested by:
1. Creating a fresh Ubuntu 24.04 VM or container
2. Running the installation script with simulated non-TTY conditions:
   ```bash
   # Simulate non-interactive execution
   bash -c 'curl -fsSL https://deno.land/install.sh | sh -s -- -y' < /dev/null
   ```
3. Verifying Deno is installed correctly:
   ```bash
   ~/.deno/bin/deno --version
   ```

## Recommendations

1. **Apply the fix** - Update the Deno and SDKMAN installation commands
2. **Add CI environment detection** - Consider setting `CI=true` for all installer calls within the script
3. **Test in Docker** - Ensure the script works in Docker build environments
4. **Document non-interactive requirements** - Add comments explaining why `-y` flags are needed

## Conclusion

This is a classic non-interactive shell compatibility issue. Modern language installers often assume interactive TTY access for user-friendly prompts, but this breaks in automated/scripted environments. The solution is straightforward: use the non-interactive flags provided by each installer.
