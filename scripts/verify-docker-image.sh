#!/usr/bin/env bash
# verify-docker-image.sh
#
# Verifies the hive-mind Docker image has all required tools.
# Run this script inside the Docker container:
#
#   docker run --rm IMAGE bash scripts/verify-docker-image.sh
#
# This script verifies:
#   1. User rename (sandbox -> hive)
#   2. All system & development tools (from sandbox base image, alphabetical order)
#   3. AI-specific tools (added by hive-mind on top of sandbox)
#
# Exit code 0 = all checks passed; non-zero = one or more checks failed.

set -euo pipefail

# ---------------------------------------------------------------------------
# Source shell initialisation files so that user-installed tools are on PATH
# Third-party init scripts may reference unset variables, so we temporarily
# disable the unbound-variable check (set -u) while sourcing them.
# ---------------------------------------------------------------------------
export HOME=/home/hive
# Add ~/.local/bin for user-installed binaries (e.g. opam installed by rocq install script)
export PATH="$HOME/.local/bin:$PATH"

# Disable -u temporarily for all third-party init scripts
set +u

[ -s "$HOME/.nvm/nvm.sh" ]           && source "$HOME/.nvm/nvm.sh"
[ -s "$HOME/.cargo/env" ]            && source "$HOME/.cargo/env"
[ -s "$HOME/.elan/env" ]             && source "$HOME/.elan/env"

export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
if command -v pyenv &>/dev/null; then
  eval "$(pyenv init --path)"
  eval "$(pyenv init -)"
fi

export SDKMAN_DIR="$HOME/.sdkman"
if [ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]; then
  source "$SDKMAN_DIR/bin/sdkman-init.sh"
fi

# Source Go environment (GOPATH moved to .go/path in issue #1004)
if [ -d "$HOME/.go" ]; then
  export GOROOT="$HOME/.go"
  export GOPATH="$HOME/.go/path"
  export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"
fi

# Perlbrew moved to .perl5 in issue #1004
export PERLBREW_ROOT="$HOME/.perl5"
[ -s "$PERLBREW_ROOT/etc/bashrc" ] && source "$PERLBREW_ROOT/etc/bashrc"

# Re-enable strict mode for our own code
set -u

# ---------------------------------------------------------------------------
# Helper: check a single command
# Usage: check_tool "Display Name" command [--version-flag]
# ---------------------------------------------------------------------------
check_tool() {
  local name="$1"
  local cmd="$2"
  local ver_flag="${3:---version}"
  echo ""
  echo "Checking ${name}..."
  if command -v "$cmd" &>/dev/null; then
    "$cmd" $ver_flag 2>&1 | head -n1 || true
    echo "${name} is accessible"
  else
    echo "${name} command not found in container"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Step 1: Verify user rename (sandbox -> hive)
# ---------------------------------------------------------------------------
echo "=== Verifying user rename (sandbox -> hive) ==="
echo ""

CURRENT_USER=$(whoami)
echo "Current user: $CURRENT_USER"
if [ "$CURRENT_USER" != "hive" ]; then
  echo "ERROR: Expected user hive, got $CURRENT_USER"
  exit 1
fi

if [ "$HOME" != "/home/hive" ]; then
  echo "ERROR: HOME should be /home/hive, got $HOME"
  exit 1
fi

if [ ! -d /home/hive ]; then
  echo "ERROR: /home/hive directory does not exist"
  exit 1
fi

if [ ! -w /home/hive ]; then
  echo "ERROR: /home/hive is not writable by hive user"
  exit 1
fi

# Verify .config directory ownership (see issue #1419)
# Root-owned .config prevents tools from creating config subdirectories at runtime
if [ -d /home/hive/.config ]; then
  CONFIG_OWNER=$(stat -c '%U' /home/hive/.config 2>/dev/null || stat -f '%Su' /home/hive/.config 2>/dev/null)
  echo ".config directory owner: $CONFIG_OWNER"
  if [ "$CONFIG_OWNER" != "hive" ]; then
    echo "ERROR: /home/hive/.config is owned by $CONFIG_OWNER, expected hive"
    echo "This causes EACCES errors when tools try to create config subdirectories"
    echo "See: https://github.com/link-assistant/hive-mind/issues/1419"
    exit 1
  fi
  echo ".config directory ownership: OK"
else
  echo ".config directory does not exist yet (will be created at runtime): OK"
fi

# Verify hive user can create directories in .config (see issue #1419)
if mkdir -p /home/hive/.config/.verify-test 2>/dev/null; then
  rmdir /home/hive/.config/.verify-test 2>/dev/null
  echo ".config directory write access: OK"
else
  echo "ERROR: hive user cannot create directories in /home/hive/.config"
  echo "See: https://github.com/link-assistant/hive-mind/issues/1419"
  exit 1
fi

echo "User rename verification: PASSED"
echo ""

# ---------------------------------------------------------------------------
# Step 2: Verify all system & development tools (alphabetical order)
# ---------------------------------------------------------------------------
echo "=== Verifying system & development tools (from sandbox base) ==="
echo "Checking all tools in alphabetical order to reduce merge conflicts"

check_tool "Bun"       bun       --version
check_tool "Cargo"     cargo     --version
check_tool "Clang"     clang     --version
check_tool "Clang++"   clang++   --version
check_tool "CMake"     cmake     --version
check_tool "Deno"      deno      --version
check_tool "Elan"      elan      --version
check_tool "G++"       g++       --version
check_tool "GCC"       gcc       --version
check_tool "Git"       git       --version
check_tool "GitHub CLI" gh       --version
check_tool "Go"        go        version
check_tool "Homebrew"  brew      --version
check_tool "Java"      java      -version
check_tool "Lake"      lake      --version
check_tool "Lean"      lean      --version
check_tool "LLD Linker" lld      --version
check_tool "LLVM"      llvm-config --version

check_tool "Make"      make      --version

check_tool "Node.js"   node      --version
check_tool "NPM"       npm       --version
check_tool "Opam"      opam      --version

echo ""
echo "Checking PHP..."
if command -v php &>/dev/null; then
  php --version | head -n1
  echo "PHP is accessible"
elif [ -x /home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php ]; then
  /home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php --version | head -n1
  echo "PHP is installed but not in PATH (may need shell restart)"
else
  echo "PHP not found in container"
  exit 1
fi

check_tool "Perl"      perl      --version

check_tool "Perlbrew"  perlbrew  --version
check_tool "Playwright" playwright --version

echo ""
echo "Checking Playwright browsers..."
PLAYWRIGHT_CACHE="$HOME/.cache/ms-playwright"
BROWSERS_REQUIRED="chromium firefox webkit"
BROWSERS_MISSING=""

for browser in $BROWSERS_REQUIRED; do
  BROWSER_DIR=$(ls -d "${PLAYWRIGHT_CACHE}/${browser}"* 2>/dev/null | head -1 || true)
  if [ -n "$BROWSER_DIR" ] && [ -d "$BROWSER_DIR" ]; then
    echo "  $browser: OK ($(basename "$BROWSER_DIR"))"
  else
    echo "  $browser: MISSING"
    BROWSERS_MISSING="$BROWSERS_MISSING $browser"
  fi
done

# Check optional browsers (chromium_headless_shell, ffmpeg)
for browser in chromium_headless_shell ffmpeg; do
  BROWSER_DIR=$(ls -d "${PLAYWRIGHT_CACHE}/${browser}"* 2>/dev/null | head -1 || true)
  if [ -n "$BROWSER_DIR" ] && [ -d "$BROWSER_DIR" ]; then
    echo "  $browser: OK ($(basename "$BROWSER_DIR"))"
  else
    echo "  $browser: not installed (optional)"
  fi
done

if [ -n "$BROWSERS_MISSING" ]; then
  echo "ERROR: Required Playwright browsers missing:$BROWSERS_MISSING"
  echo "The Playwright MCP server requires these browsers to function properly."
  echo "See issue #1060 for more details."
  exit 1
else
  echo "All required Playwright browsers are installed"
fi

check_tool "Python"    python    --version
check_tool "Pyenv"     pyenv     --version

echo ""
echo "Checking Rocq/Coq..."
# Source opam environment for Rocq/Coq access
# Reference: https://rocq-prover.org/docs/using-opam
set +u  # opam init scripts may reference unset variables
if [ -f "$HOME/.opam/opam-init/init.sh" ]; then
  source "$HOME/.opam/opam-init/init.sh" > /dev/null 2>&1 || true
fi
# Also try eval opam env for full environment setup
eval "$(opam env --switch=default 2>/dev/null)" || true
set -u

# Verify Rocq installation
# Rocq 9.0+ provides: rocq (CLI tool), rocqc (compiler alias), coqc (legacy compiler)
ROCQ_VERIFIED=false
if rocq -v &>/dev/null; then
  rocq -v | head -n1
  echo "Rocq is accessible (verified with rocq -v)"
  ROCQ_VERIFIED=true
elif command -v rocqc &>/dev/null && rocqc --version &>/dev/null; then
  rocqc --version | head -n1
  echo "Rocq is accessible (verified with rocqc)"
  ROCQ_VERIFIED=true
elif command -v coqc &>/dev/null && coqc --version &>/dev/null; then
  coqc --version | head -n1
  echo "Coq is accessible (legacy compiler)"
  ROCQ_VERIFIED=true
fi

if [ "$ROCQ_VERIFIED" = false ]; then
  echo "Rocq/Coq verification failed: checking opam installation..."
  # Show diagnostic information
  if opam list --installed rocq-prover 2>/dev/null | grep -q rocq-prover; then
    echo "rocq-prover package is installed in opam"
    echo "Opam bin directory contents:"
    ls -la "$HOME/.opam/default/bin/" 2>/dev/null | grep -i 'rocq\|coq' || echo "No rocq/coq binaries found in opam bin"
    echo "Installed opam packages:"
    opam list --installed 2>/dev/null | grep -i 'rocq\|coq' || echo "No rocq/coq packages found"
  else
    echo "rocq-prover package NOT installed in opam"
    echo "Available opam packages:"
    opam list 2>/dev/null | head -20 || echo "Could not list opam packages"
  fi
  echo ""
  echo "ERROR: Rocq/Coq not accessible in container"
  echo "This indicates the Rocq installation failed or binaries were not properly installed"
  echo "See issue #952 for more details: https://github.com/link-assistant/hive-mind/issues/952"
  exit 1
fi

check_tool "Rust"      rustc     --version
check_tool "SDKMAN"    sdk       version

echo ""
echo "=== All system & development tools verification checks PASSED ==="

# ---------------------------------------------------------------------------
# Step 3: Verify AI-specific tools (added by hive-mind on top of sandbox)
# ---------------------------------------------------------------------------
echo ""
echo "=== Verifying AI-specific tools (hive-mind additions) ==="

# Global bun packages
if bun pm ls -g &>/dev/null; then
  echo "Bun global packages accessible"
  bun pm ls -g 2>/dev/null | head -20 || true
else
  echo "WARNING: Could not list bun global packages"
fi

echo ""
echo "=== All hive-mind Docker image verification checks PASSED ==="
