# Root Cause Analysis: Rocq Installation Verification Issue

## Problem Statement

After installing Rocq via opam, the Installation Summary shows a warning:

```
[!] Rocq: installed via opam but not in current PATH
[i] Rocq will be available after shell restart or: eval $(opam env)
```

However, even in the running container, Rocq is not accessible.

## Technical Deep Dive

### How Opam Works

Opam (OCaml Package Manager) manages OCaml installations and packages in isolated "switches". When you install a package:

1. The package is compiled and installed into the switch directory (e.g., `~/.opam/default/`)
2. Binaries are placed in `~/.opam/default/bin/`
3. Environment variables must be set via `eval $(opam env)` to:
   - Add the bin directory to PATH
   - Set OPAM_SWITCH_PREFIX
   - Set CAML_LD_LIBRARY_PATH
   - And other OCaml-related variables

### The Current Installation Flow

```
Installation Script
       |
       v
  opam init --disable-sandboxing --auto-setup -y
       |
       v
  eval "$(opam env --switch=default 2>/dev/null)"
       |
       v
  opam install rocq-prover -y
       |
       v
  [Installation completes in script context]
       |
       v
  Script ends -> shell environment lost
       |
       v
  Docker image saved
       |
       v
  New container shell opened
       |
       v
  opam env NOT automatically evaluated
       |
       v
  rocq command NOT found
```

### Why the PATH Entry Doesn't Work

The Dockerfile includes:

```dockerfile
ENV PATH="/home/hive/.opam/default/bin:${PATH}"
```

This should theoretically work, but:

1. **The path may not exist at build time**: If opam hasn't created the switch yet
2. **The binary name may differ**: The command might be `rocq` or `coqc` depending on version
3. **Other environment variables are missing**: PATH alone isn't sufficient for opam

### Missing Environment Variables

When you run `opam env`, it outputs more than just PATH:

```bash
OPAM_SWITCH_PREFIX='/home/hive/.opam/default'; export OPAM_SWITCH_PREFIX;
CAML_LD_LIBRARY_PATH='/home/hive/.opam/default/lib/stublibs:...'; export CAML_LD_LIBRARY_PATH;
OCAML_TOPLEVEL_PATH='/home/hive/.opam/default/lib/toplevel'; export OCAML_TOPLEVEL_PATH;
PATH='/home/hive/.opam/default/bin:/usr/local/sbin:...'; export PATH;
```

These additional variables may be required for Rocq to function correctly.

### Installation Script Verification Flow

Current code (lines 1324-1336):

```bash
if command -v rocq &>/dev/null; then
  log_success "Rocq: $(rocq --version | head -n1)"
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

**Problem**: This logic:

1. First checks if command exists (may fail due to PATH)
2. Then checks if package is installed via opam (shows warning)
3. Does NOT attempt to fix the PATH issue
4. Does NOT verify the installation actually works

### CI Workflow Verification

The CI workflow sources the opam init script:

```bash
if [ -f \"\$HOME/.opam/opam-init/init.sh\" ]; then
  source \"\$HOME/.opam/opam-init/init.sh\" > /dev/null 2>&1 || true
fi
```

But then treats failure as acceptable:

```bash
else
  echo 'Rocq/Coq command not found in container (this is acceptable - theorem provers are optional)'
fi
```

## Root Causes Identified

### Root Cause 1: Incomplete Environment Setup in Docker

The Dockerfile only sets PATH but doesn't initialize the full opam environment. The shell initialization files (`.bashrc`, `.profile`) are modified by opam init, but these aren't sourced in non-interactive Docker runs.

### Root Cause 2: No Post-Installation Verification

The installation script doesn't verify that Rocq is actually usable. Per the [official documentation](https://rocq-prover.org/docs/using-opam):

> "To ensure that installation was successful, check that `rocq -v` prints the expected version of Rocq."

### Root Cause 3: CI Treats Rocq as Optional

The comment "theorem provers are optional" is incorrect - if we're installing Rocq, we want it to work. The CI should verify the installation succeeded.

## Verification That Would Work

```bash
# Source opam environment
eval "$(opam env --switch=default)"

# Verify Rocq is accessible
if rocq -v 2>/dev/null; then
  echo "Rocq installation verified"
else
  echo "ERROR: Rocq not accessible after sourcing opam env"
  exit 1
fi
```

## Files Analyzed

1. `scripts/ubuntu-24-server-install.sh` - Installation script
2. `.github/workflows/release.yml` - CI workflow
3. `Dockerfile` - Docker image configuration
4. CI run logs from run #20410304357
