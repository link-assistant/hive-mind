# Case Study: Issue #952 - Rocq Installation Not Verified Properly

## Executive Summary

The installation of [Rocq Prover](https://rocq-prover.org/) (formerly known as Coq) via opam is not being properly verified after installation. The installation script shows a warning that Rocq is "installed via opam but not in current PATH" but treats this as acceptable. The CI/CD pipeline also treats Rocq as "optional" and doesn't fail when it's not accessible. This results in a broken Rocq installation in the Docker image that users cannot actually use.

## The Problem

### Symptoms

1. Installation Summary shows: `[!] Rocq: installed via opam but not in current PATH`
2. CI logs show: `WARNING: Rocq/Coq success message not found in logs`
3. Container verification shows: `Rocq/Coq command not found in container (this is acceptable - theorem provers are optional)`
4. The `rocq -v` command fails after installation

### User Impact

Users who expect to use Rocq in the Docker container find that it's not accessible, even though the installation log claims it was installed successfully.

## Investigation Findings

### Root Cause Analysis

After analyzing the installation script (`scripts/ubuntu-24-server-install.sh`) and CI workflow (`.github/workflows/release.yml`), we identified **two distinct issues**:

#### Issue 1: Installation Script Doesn't Ensure PATH Accessibility

**Location**: `scripts/ubuntu-24-server-install.sh`, lines 1324-1336

```bash
if command -v rocq &>/dev/null; then
  log_success "Rocq: $(rocq --version | head -n1)"
elif command -v coqc &>/dev/null; then
  log_success "Coq: $(coqc --version | head -n1)"
elif opam list --installed rocq-prover 2>/dev/null | grep -q "rocq-prover"; then
  log_warning "Rocq: installed via opam but not in current PATH"   # <-- WARNING, NOT ERROR
  log_note "Rocq will be available after shell restart or: eval \$(opam env)"
```

**Problem**: The script considers "installed but not in PATH" as acceptable (warning), when it should ensure accessibility before considering installation complete.

#### Issue 2: CI Treats Rocq as Optional

**Location**: `.github/workflows/release.yml`, lines 1361-1374

```bash
if command -v rocq &>/dev/null; then
  rocq --version | head -n1
  echo 'Rocq is accessible'
elif command -v coqc &>/dev/null; then
  coqc --version | head -n1
  echo 'Coq is accessible'
else
  echo 'Rocq/Coq command not found in container (this is acceptable - theorem provers are optional)'
  # NOTE: Does NOT exit 1 - just continues
fi
```

**Problem**: The CI explicitly marks Rocq as "optional" and doesn't fail when it's not accessible.

### Why Rocq Isn't in PATH

According to [Rocq's official documentation](https://rocq-prover.org/docs/using-opam):

> "Every time a new shell is opened you have to type in the `eval $(opam env)` command to update environment variables."

The issue is that:
1. During the installation script, `eval $(opam env)` is run
2. But the **Installation Summary** runs in the same script context
3. When checking `command -v rocq`, the opam environment has been evaluated
4. However, the Dockerfile PATH doesn't include the opam binaries correctly
5. When the container runs, a new shell is opened, and opam env is not automatically evaluated

### Dockerfile Analysis

**Location**: `Dockerfile`, lines 36-37

```dockerfile
# Include Opam paths for Rocq/Coq theorem prover
ENV PATH="/home/hive/.elan/bin:/home/hive/.opam/default/bin:/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:..."
```

The PATH includes `/home/hive/.opam/default/bin` but:
1. This path may not contain the Rocq binary directly
2. The actual binary location may be version-specific (e.g., `/home/hive/.opam/default/bin/rocq` may be a symlink)
3. The opam environment may need other variables besides PATH

## Timeline of Events

| Time | Event |
|------|-------|
| During Install | Opam installed and initialized successfully |
| During Install | Rocq-prover package installed via opam |
| During Install | `eval $(opam env)` executed in installation context |
| Installation Summary | Warning logged: "Rocq: installed via opam but not in current PATH" |
| Docker Build | Dockerfile sets PATH with opam bin directory |
| Container Runtime | `rocq` command not found because opam env not fully initialized |
| CI Verification | Failure treated as acceptable: "theorem provers are optional" |

## Evidence from CI Logs

### Successful Run #20410304357 (2025-12-21)

1. **Installation Log**:
   ```
   [!] Rocq: installed via opam but not in current PATH
   [i] Rocq will be available after shell restart or: eval $(opam env)
   ```

2. **Build Log Verification**:
   ```
   WARNING: Rocq/Coq success message not found in logs (may appear as 'installed but not in current PATH' during build)
   ```

3. **Container Verification**:
   ```
   Checking Rocq/Coq...
   Rocq/Coq command not found in container (this is acceptable - theorem provers are optional)
   ```

## Proposed Solutions

### Solution 1: Ensure PATH Accessibility in Installation Script

Modify the installation script to:
1. Source opam environment after installation
2. Verify `rocq -v` works as per [official documentation](https://rocq-prover.org/docs/using-opam)
3. If verification fails, treat it as an error, not a warning

### Solution 2: Fix Dockerfile Environment Setup

Ensure the Dockerfile properly initializes the opam environment:
1. Add opam initialization to `.bashrc` entry point
2. Or add a Docker ENTRYPOINT that sources opam env

### Solution 3: Make CI Verification Strict

Update the CI workflow to:
1. Remove the "optional" treatment of Rocq
2. Fail the build if Rocq is not accessible after sourcing opam env

## References

### Official Documentation

- [Installing the Rocq Prover and its packages](https://rocq-prover.org/docs/using-opam) - Official Rocq installation guide via opam
- [Install the Rocq Prover](https://rocq-prover.org/install) - Main installation page
- [Rocq GitHub Repository](https://github.com/rocq-prover/rocq/blob/master/INSTALL.md) - Installation documentation

### Key Quote from Rocq Documentation

> "To ensure that installation was successful, check that `rocq -v` prints the expected version of Rocq."

### Rocq 9.0+ Command Names

According to [GitHub discussions](https://github.com/rocq-prover/rocq/issues/20031), Rocq 9.0+ provides multiple command names:
- `rocq` - CLI tool with subcommands (e.g., `rocq compile`, `rocq repl`)
- `rocqc` - Compiler alias for Rocq
- `coqc` - Legacy Coq compiler (backward compatible)

## Files in This Case Study

| File | Description |
|------|-------------|
| [README.md](./README.md) | This overview document |
| [root-cause-analysis.md](./root-cause-analysis.md) | Detailed technical analysis |
| [proposed-solutions.md](./proposed-solutions.md) | Recommended code changes |
| [ci-logs/](./ci-logs/) | Downloaded CI logs for analysis |

## Key Learnings

1. **"Installed" ≠ "Accessible"** - Installing a package via opam doesn't guarantee it's in PATH
2. **Environment variables matter** - Opam-installed tools require `eval $(opam env)` in each new shell
3. **CI should verify, not assume** - Optional treatment of required tools leads to broken installations
4. **Documentation is key** - The [official Rocq docs](https://rocq-prover.org/docs/using-opam) clearly state to verify with `rocq -v`

## Final Findings (from CI Diagnostics)

After implementing diagnostic output in the CI, we discovered the **true root cause**:

```
Checking Rocq/Coq...
Rocq/Coq verification: checking opam installation...
rocq-prover package is installed in opam
Opam bin directory contents:
No rocq/coq binaries found in opam bin
Trying: eval $(opam env) && rocq -v
bash: line 336: rocq: command not found
Still not accessible after eval opam env
WARNING: Rocq/Coq not accessible in container
```

**Key Findings:**
1. The `rocq-prover` package IS installed in opam
2. But there are NO rocq/coq binaries in `~/.opam/default/bin/`
3. Even `eval $(opam env)` doesn't make rocq accessible
4. The `rocq-prover` is a **meta-package** that depends on `rocq-core` and `rocq-stdlib`
5. The actual binary installation may have failed or the package structure doesn't include CLI tools

**This is a deeper issue with the opam package or installation process**, not just a PATH/environment issue.

## Conclusion

The investigation revealed that:

1. **The original issue was correct** - Rocq verification was not working properly
2. **Our fix improved verification** - We now properly source opam env and check multiple command names (rocq, rocqc, coqc)
3. **We added diagnostic output** - The CI now provides detailed information when Rocq is not accessible
4. **The underlying problem is deeper** - The `rocq-prover` package may not be providing the expected binaries

**Recommendation**: Investigate why `rocq-prover` opam package doesn't install binaries to `~/.opam/default/bin/`. This may require checking opam installation logs during build or investigating the package dependencies.
