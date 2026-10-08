#!/usr/bin/env bash
set -euo pipefail

# Essentials Box Installation Script
# Installs tooling required for gh-setup-git-identity and glab-setup-git-identity
# on top of an existing JS box (Node.js, Bun, Deno already available).
#
# Components added: system essentials, GitHub CLI, GitLab CLI, git identity tools
#
# This is the layer between JS box and full-box.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../common.sh" ]; then
  source "$SCRIPT_DIR/../common.sh"
elif [ -f "/tmp/common.sh" ]; then
  source "/tmp/common.sh"
else
  # Inline fallback logging
  log_info() { echo "[*] $1"; }
  log_success() { echo "[✓] $1"; }
  log_warning() { echo "[!] $1"; }
  log_error() { echo "[✗] $1"; }
  log_note() { echo "[i] $1"; }
  log_step() { echo "==> $1"; }
  command_exists() { command -v "$1" &>/dev/null; }
  maybe_sudo() { if [ "$EUID" -eq 0 ]; then "$@"; elif command -v sudo &>/dev/null; then sudo "$@"; else "$@"; fi; }
  apt_update_with_retry() { maybe_sudo apt-get update -y -o Acquire::Retries=3; }
fi

log_step "Installing Essentials Box (on top of JS box)"

# --- Pre-flight Checks ---
log_step "Running pre-flight checks"

if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
  log_error "This script requires sudo access."
  exit 1
fi

if [ -f /etc/os-release ]; then
  source /etc/os-release
  if [[ "${ID:-}" == "ubuntu" ]]; then
    log_success "Ubuntu ${VERSION_ID:-unknown} detected"
  else
    log_warning "This script is designed for Ubuntu. Detected: ${ID:-unknown}"
  fi
fi

log_success "Pre-flight checks passed"

# --- Ensure box user exists ---
log_step "Setting up box user"
if id "box" &>/dev/null; then
  log_info "box user already exists."
else
  log_info "Creating box user..."
  useradd -m -d /home/box -s /bin/bash box 2>/dev/null || adduser --disabled-password --gecos "" --home /home/box box
  passwd -d box 2>/dev/null || true
  usermod -aG sudo box 2>/dev/null || true
  # `useradd -m` copies /etc/skel only when it creates the home directory
  # itself. Over a directory that already exists it prints
  #   useradd: warning: the home directory /home/box already exists.
  #   useradd: Not copying any file from skel directory into it.
  # and leaves the user without ~/.profile, which is the file that sources
  # ~/.bashrc for an interactive *login* shell - so `su - box` and every ssh
  # session would miss the PATH lines the install scripts append to ~/.bashrc.
  # skel's .bashrc is deliberately not among the files copied back;
  # ubuntu/24.04/js/Dockerfile explains why. Never overwrites, so a re-run is a
  # no-op. (issue #123)
  for skel_file in .profile .bash_logout; do
    if [ -f "/etc/skel/$skel_file" ] && [ ! -e "/home/box/$skel_file" ]; then
      cp -a "/etc/skel/$skel_file" "/home/box/$skel_file"
      chown box:box "/home/box/$skel_file"
    fi
  done
  log_success "box user created"
fi

# --- System prerequisites ---
log_step "Installing system prerequisites"

# Clean up duplicate sources
for pair in "microsoft-edge:microsoft-edge-stable" "google-chrome:google-chrome-stable"; do
  f1="/etc/apt/sources.list.d/${pair%%:*}.list"
  f2="/etc/apt/sources.list.d/${pair##*:}.list"
  if [ -f "$f1" ] && [ -f "$f2" ]; then
    maybe_sudo rm -f "$f1"
  fi
done

apt_update_with_retry

# Core system tools
maybe_sudo apt-get install -y \
  wget curl unzip zip git sudo ca-certificates gnupg \
  build-essential expect screen

# Common development libraries used by multiple language runtimes
# (Python, Ruby, Rust, Go, etc. all benefit from these)
maybe_sudo apt-get install -y \
  libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev \
  libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev \
  libffi-dev liblzma-dev libyaml-dev

log_success "System prerequisites installed"

# Note: Playwright/Puppeteer system dependencies and browser binaries are now
# installed in the JS box layer (ubuntu/24.04/js/Dockerfile and install.sh).
# See issue #74 for details.

# --- GitHub CLI ---
log_step "Installing GitHub CLI"
if ! command_exists gh; then
  maybe_sudo mkdir -p -m 755 /etc/apt/keyrings
  out=$(mktemp)
  wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg
  cat "$out" | maybe_sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  maybe_sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  rm -f "$out"

  maybe_sudo mkdir -p -m 755 /etc/apt/sources.list.d
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | maybe_sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null

  apt_update_with_retry
  maybe_sudo apt-get install -y gh
  log_success "GitHub CLI installed"
else
  log_success "GitHub CLI already installed"
fi

# --- GitLab CLI ---
log_step "Installing GitLab CLI"
if ! command_exists glab; then
  maybe_sudo apt-get install -y glab
  log_success "GitLab CLI installed"
else
  log_success "GitLab CLI already installed"
fi

# --- Install git identity tools as box user (using Bun from JS box) ---
log_step "Installing git identity tools"

cat >/tmp/essentials-identity-setup.sh <<'EOF_IDENTITY'
#!/usr/bin/env bash
set -euo pipefail

log_info() { echo "[*] $1"; }
log_success() { echo "[✓] $1"; }
command_exists() { command -v "$1" &>/dev/null; }

# Load Bun from JS box
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# gh-setup-git-identity
if command_exists bun; then
  if ! command_exists gh-setup-git-identity; then
    log_info "Installing gh-setup-git-identity..."
    bun install -g gh-setup-git-identity
  fi
fi

# glab-setup-git-identity
if command_exists bun; then
  if ! command_exists glab-setup-git-identity; then
    log_info "Installing glab-setup-git-identity..."
    bun install -g glab-setup-git-identity
  fi
fi

# Git setup if gh is authenticated
if gh auth status &>/dev/null; then
  log_info "Configuring Git with GitHub identity..."
  git config --global user.name "$(gh api user --jq .login)"
  git config --global user.email "$(gh api user/emails --jq '.[] | select(.primary==true).email')"
  gh auth setup-git
fi

# Note: playwright, @playwright/test, and @puppeteer/browsers CLIs are now
# installed in the JS box layer (ubuntu/24.04/js/install.sh).
# Browser binaries are also pre-downloaded there. See issue #74.

log_success "Essentials identity tools setup complete"
EOF_IDENTITY

chmod +x /tmp/essentials-identity-setup.sh
if [ "$EUID" -eq 0 ]; then
  su - box -c "bash /tmp/essentials-identity-setup.sh"
else
  sudo -i -u box bash /tmp/essentials-identity-setup.sh
fi
rm -f /tmp/essentials-identity-setup.sh

# --- Cleanup ---
log_step "Cleaning up"
maybe_sudo apt-get clean
maybe_sudo apt-get autoclean
maybe_sudo apt-get autoremove -y
maybe_sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

log_step "Essentials Box setup complete!"
log_success "Added on top of JS box: git, gh, glab, gh-setup-git-identity, glab-setup-git-identity"
