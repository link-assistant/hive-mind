#!/usr/bin/env bash
# verify-docker-image.sh
#
# Verifies the hive-mind Docker image has all required tools.
# Run this script inside the Docker container:
#
#   docker run --rm IMAGE bash scripts/verify-docker-image.sh
#
# This script verifies:
#   1. User setup (box user with /home/box access)
#   2. All system & development tools (from Box base image, alphabetical order)
#   3. AI-specific tools (added by hive-mind on top of Box)
#
# Exit code 0 = all checks passed; non-zero = one or more checks failed.

set -euo pipefail

# ---------------------------------------------------------------------------
# Source shell initialisation files so that user-installed tools are on PATH
# Third-party init scripts may reference unset variables, so we temporarily
# disable the unbound-variable check (set -u) while sourcing them.
# ---------------------------------------------------------------------------
export HOME=/home/box
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
# Step 1: Verify user setup (box user with /home/box access)
# ---------------------------------------------------------------------------
echo "=== Verifying user setup (box user with /home/box access) ==="
echo ""

CURRENT_USER=$(whoami)
echo "Current user: $CURRENT_USER"
if [ "$CURRENT_USER" != "box" ]; then
  echo "ERROR: Expected user box, got $CURRENT_USER"
  exit 1
fi

if [ "$HOME" != "/home/box" ]; then
  echo "ERROR: HOME should be /home/box, got $HOME"
  exit 1
fi

if [ ! -d /home/box ]; then
  echo "ERROR: /home/box directory does not exist"
  exit 1
fi

if [ ! -w /home/box ]; then
  echo "ERROR: /home/box is not writable by box user"
  exit 1
fi

# Verify box user is in the box group
if id -nG box | grep -qw box; then
  echo "box user is in box group: OK"
else
  echo "ERROR: box user is not in the box group"
  exit 1
fi

# Verify .config directory ownership (see issue #1419)
# Root-owned .config prevents tools from creating config subdirectories at runtime
if [ -d /home/box/.config ]; then
  CONFIG_OWNER=$(stat -c '%U' /home/box/.config 2>/dev/null || stat -f '%Su' /home/box/.config 2>/dev/null)
  echo ".config directory owner: $CONFIG_OWNER"
  if [ "$CONFIG_OWNER" != "box" ]; then
    echo "ERROR: /home/box/.config is owned by $CONFIG_OWNER, expected box"
    echo "This causes EACCES errors when tools try to create config subdirectories"
    echo "See: https://github.com/link-assistant/hive-mind/issues/1419"
    exit 1
  fi
  echo ".config directory ownership: OK"
else
  echo ".config directory does not exist yet (will be created at runtime): OK"
fi

# Verify box user can create directories in .config (see issue #1419)
if mkdir -p /home/box/.config/.verify-test 2>/dev/null; then
  rmdir /home/box/.config/.verify-test 2>/dev/null
  echo ".config directory write access: OK"
else
  echo "ERROR: box user cannot create directories in /home/box/.config"
  echo "See: https://github.com/link-assistant/hive-mind/issues/1419"
  exit 1
fi

echo "User setup verification: PASSED"
echo ""

# ---------------------------------------------------------------------------
# Step 2: Verify all system & development tools (alphabetical order)
# ---------------------------------------------------------------------------
echo "=== Verifying system & development tools (from Box base) ==="
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

# Google Chrome — in Box 2.0.1+, installed as box user to Playwright cache
# (no longer system-wide via sudo). Check cache directory, with command fallback.
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then
  CHROME_DIR=$(ls -d "${PLAYWRIGHT_CACHE}/chrome"* 2>/dev/null | head -1 || true)
  if [ -n "$CHROME_DIR" ] && [ -d "$CHROME_DIR" ]; then
    echo "  chrome: OK ($(basename "$CHROME_DIR"))"
  elif command -v google-chrome &>/dev/null; then
    echo "  chrome: OK ($(google-chrome --version 2>/dev/null || echo 'installed'))"
  else
    echo "  chrome: MISSING"
    BROWSERS_MISSING="$BROWSERS_MISSING chrome"
  fi
fi

# Check optional browsers (chromium_headless_shell, ffmpeg in cache; msedge in cache or system)
for browser in chromium_headless_shell ffmpeg; do
  BROWSER_DIR=$(ls -d "${PLAYWRIGHT_CACHE}/${browser}"* 2>/dev/null | head -1 || true)
  if [ -n "$BROWSER_DIR" ] && [ -d "$BROWSER_DIR" ]; then
    echo "  $browser: OK ($(basename "$BROWSER_DIR"))"
  else
    echo "  $browser: not installed (optional)"
  fi
done

# msedge — in Box 2.0.1+, installed to Playwright cache as box user
MSEDGE_DIR=$(ls -d "${PLAYWRIGHT_CACHE}/msedge"* 2>/dev/null | head -1 || true)
if [ -n "$MSEDGE_DIR" ] && [ -d "$MSEDGE_DIR" ]; then
  echo "  msedge: OK ($(basename "$MSEDGE_DIR"))"
elif command -v microsoft-edge &>/dev/null; then
  echo "  msedge: OK ($(microsoft-edge --version 2>/dev/null || echo 'installed'))"
else
  echo "  msedge: not installed (optional)"
fi

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
# Step 3: Verify AI-specific tools (added by hive-mind on top of Box)
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
echo "Checking Hive-Mind configure-claude bin..."
if command -v configure-claude >/dev/null 2>&1; then
  configure-claude --help | head -n1 || true
  echo "configure-claude is accessible"

  echo ""
  echo "Verifying quiet Claude Code baseline..."
  configure-claude --settings-path /home/box/.claude/settings.json --verify
  echo "Quiet Claude Code baseline: OK"
else
  # PR Docker builds install @link-assistant/hive-mind@latest, which can pre-date
  # this PR and therefore not ship the configure-claude bin yet. Release builds
  # install an exact pinned version where the bin must exist (enforced in the
  # Dockerfile itself when HIVE_MIND_VERSION != latest).
  echo "configure-claude not found — tolerated only for PR builds where @link-assistant/hive-mind@latest pre-dates this PR"
  echo "(solve re-applies the quiet baseline at runtime)"
fi

echo ""
echo "Checking Playwright MCP registration in Claude and Codex..."

if command -v claude &>/dev/null; then
  CLAUDE_MCP_OUTPUT=$(claude mcp list 2>&1 || true)
  if grep -qi 'playwright' <<< "$CLAUDE_MCP_OUTPUT"; then
    echo "Claude Playwright MCP registration: OK"
  else
    echo "ERROR: Claude Playwright MCP registration missing"
    echo "$CLAUDE_MCP_OUTPUT"
    echo "This image is expected to preconfigure Playwright MCP for Claude during build."
    exit 1
  fi
else
  echo "ERROR: Claude CLI command not found while verifying Playwright MCP registration"
  exit 1
fi

if command -v codex &>/dev/null; then
  CODEX_MCP_OUTPUT=$(codex mcp list 2>&1 || true)
  if grep -qi 'playwright' <<< "$CODEX_MCP_OUTPUT"; then
    echo "Codex Playwright MCP registration: OK"
  else
    echo "ERROR: Codex Playwright MCP registration missing"
    echo "$CODEX_MCP_OUTPUT"
    echo "This image is expected to preconfigure Playwright MCP for Codex during build."
    echo "If this happens only in a runtime container with mounted /home/box/.codex, the mount may be overriding the image-baked Codex config."
    exit 1
  fi
else
  echo "ERROR: Codex CLI command not found while verifying Playwright MCP registration"
  exit 1
fi

echo ""
echo "=== All hive-mind Docker image verification checks PASSED ==="
