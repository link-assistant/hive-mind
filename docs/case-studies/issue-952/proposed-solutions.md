# Proposed Solutions for Rocq Installation Verification

## Overview

This document outlines the recommended changes to fix the Rocq installation verification issue.

## Solution 1: Fix Installation Script to Verify Rocq Accessibility

### File: `scripts/ubuntu-24-server-install.sh`

#### Change 1: Source opam environment before verification

Add opam environment sourcing before the Installation Summary section to ensure consistent verification:

```bash
# Before Installation Summary, source opam environment
if [ -f "$HOME/.opam/opam-init/init.sh" ]; then
  source "$HOME/.opam/opam-init/init.sh" > /dev/null 2>&1 || true
fi
```

#### Change 2: Verify Rocq with `rocq -v` as per official documentation

Update the Rocq verification section to:
1. Source opam environment
2. Check `rocq -v` command as recommended by [official docs](https://rocq-prover.org/docs/using-opam)
3. Show success with version, or clear error if not working

```bash
# Verify Rocq installation
# Source opam environment first
if [ -f "$HOME/.opam/opam-init/init.sh" ]; then
  source "$HOME/.opam/opam-init/init.sh" > /dev/null 2>&1 || true
fi

if rocq -v &>/dev/null; then
  log_success "Rocq: $(rocq -v 2>&1 | head -n1)"
elif command -v rocq &>/dev/null; then
  log_success "Rocq: $(rocq --version 2>&1 | head -n1)"
elif command -v coqc &>/dev/null; then
  log_success "Coq: $(coqc --version | head -n1)"
elif opam list --installed rocq-prover 2>/dev/null | grep -q "rocq-prover"; then
  log_warning "Rocq: installed via opam but not in current PATH"
  log_note "Rocq will be available after shell restart or: eval \$(opam env)"
elif opam list --installed coq 2>/dev/null | grep -q "coq"; then
  log_warning "Coq: installed via opam but not in current PATH"
  log_note "Coq will be available after shell restart or: eval \$(opam env)"
else
  log_warning "Rocq/Coq: not found"
fi
```

## Solution 2: Update CI Workflow to Properly Verify Rocq

### File: `.github/workflows/release.yml`

#### Change 1: Remove "optional" treatment and require Rocq to work

Update the container verification step:

**Before:**
```bash
if command -v rocq &>/dev/null; then
  rocq --version | head -n1
  echo 'Rocq is accessible'
elif command -v coqc &>/dev/null; then
  coqc --version | head -n1
  echo 'Coq is accessible'
else
  echo 'Rocq/Coq command not found in container (this is acceptable - theorem provers are optional)'
fi
```

**After:**
```bash
echo ''
echo 'Checking Rocq/Coq...'
# Source opam environment for Rocq/Coq access
if [ -f \"\$HOME/.opam/opam-init/init.sh\" ]; then
  source \"\$HOME/.opam/opam-init/init.sh\" > /dev/null 2>&1 || true
fi
# Try rocq -v first (official verification command)
if rocq -v &>/dev/null; then
  rocq -v | head -n1
  echo 'Rocq is accessible (verified with rocq -v)'
elif command -v rocq &>/dev/null; then
  rocq --version | head -n1
  echo 'Rocq is accessible'
elif command -v coqc &>/dev/null; then
  coqc --version | head -n1
  echo 'Coq is accessible'
else
  echo 'Rocq/Coq command not found in container'
  exit 1
fi
```

#### Change 2: Update build log verification to fail on Rocq issues

**Before:**
```bash
if grep -E '\[✓\] Rocq:|\[✓\] Coq:' build-output.log; then
  echo "Rocq/Coq installation verified in build logs"
else
  echo "WARNING: Rocq/Coq success message not found in logs (may appear as 'installed but not in current PATH' during build)"
fi
```

**After:**
```bash
if grep -E '\[✓\] Rocq:|\[✓\] Coq:' build-output.log; then
  echo "Rocq/Coq installation verified in build logs"
elif grep -E '\[!\] Rocq:.*not in current PATH' build-output.log; then
  echo "WARNING: Rocq installed but not in PATH during build (will be verified in container)"
else
  echo "ERROR: Rocq/Coq installation appears to have failed"
  grep -i "rocq\|coq" build-output.log || true
  exit 1
fi
```

## Solution 3: Ensure Dockerfile Properly Initializes Opam

### File: `Dockerfile`

Add an ENTRYPOINT or shell initialization that sources opam env:

```dockerfile
# Add to the Dockerfile after switching to hive user
# Create a bashrc that sources opam env
RUN echo 'test -r $HOME/.opam/opam-init/init.sh && . $HOME/.opam/opam-init/init.sh > /dev/null 2> /dev/null || true' >> /home/hive/.bashrc
```

Or update the shell command:

```dockerfile
SHELL ["/bin/bash", "-c", "source ~/.bashrc && exec bash"]
```

## Implementation Priority

1. **High Priority**: Fix the CI workflow to source opam environment before checking (Solution 2, Change 1)
2. **High Priority**: Update Installation Summary to source opam env before verification (Solution 1)
3. **Medium Priority**: Remove "optional" treatment from CI (Solution 2, Change 1)
4. **Medium Priority**: Add `rocq -v` verification per official docs (Solution 1, Change 2)
5. **Low Priority**: Dockerfile improvements (Solution 3)

## Testing the Fix

After implementing the changes:

1. **Local Test**:
   ```bash
   docker build -t test-rocq .
   docker run --rm test-rocq bash -c "source ~/.bashrc && rocq -v"
   ```

2. **CI Test**:
   - Push changes to a branch
   - Check that docker-pr-check job passes
   - Verify Rocq shows as `[✓]` in build logs
   - Verify container verification shows Rocq version

## References

- [Rocq Installation Guide](https://rocq-prover.org/docs/using-opam) - Official opam installation instructions
- [Rocq Verification](https://rocq-prover.org/docs/using-opam) - "To ensure that installation was successful, check that `rocq -v` prints the expected version"
