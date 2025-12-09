#!/usr/bin/env bash
set -euo pipefail

# Color codes for enhanced output (disabled in non-TTY)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  CYAN=''
  NC=''
fi

# Enhanced logging functions
log_info() {
  echo -e "${BLUE}[*]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
  echo -e "${RED}[✗]${NC} $1"
}

log_note() {
  echo -e "${CYAN}[i]${NC} $1"
}

log_step() {
  echo -e "\n${GREEN}==>${NC} ${BLUE}$1${NC}\n"
}

# Verification helper
verify_command() {
  local tool_name="$1"
  local command_name="${2:-$1}"
  local version_flag="${3:---version}"

  if command -v "$command_name" &>/dev/null; then
    local version=$("$command_name" $version_flag 2>/dev/null | head -n1 || echo "installed")
    log_success "$tool_name: $version"
    return 0
  else
    log_warning "$tool_name: not found in PATH"
    return 1
  fi
}

# Check if a command exists (silent)
command_exists() {
  command -v "$1" &>/dev/null
}

# Run command with sudo only if not root and sudo is available
maybe_sudo() {
  if [ "$EUID" -eq 0 ]; then
    # Running as root, execute directly
    "$@"
  elif command_exists sudo; then
    # Not root but sudo available
    sudo "$@"
  else
    # Not root and sudo not available - try directly (will fail if permissions needed)
    "$@"
  fi
}

# --- Pre-flight Checks ---
log_step "Running pre-flight checks"

# Check if running as root or with sudo access
if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
  log_error "This script requires sudo access. Please run with sudo or ensure user has sudo privileges."
  exit 1
fi

# Check Ubuntu version
if [ -f /etc/os-release ]; then
  source /etc/os-release
  if [[ "$ID" != "ubuntu" ]]; then
    log_warning "This script is designed for Ubuntu. Detected: $ID"
    log_note "Continuing anyway, but some steps may fail..."
  fi

  if [[ "$VERSION_ID" != "24.04" ]] && [[ "$VERSION_ID" != "24.10" ]]; then
    log_warning "This script is tested on Ubuntu 24.x. Detected: $VERSION_ID"
    log_note "Continuing anyway, but compatibility issues may occur..."
  else
    log_success "Ubuntu $VERSION_ID detected"
  fi
fi

# Check available disk space (need at least 15GB free)
AVAILABLE_GB=$(df / | awk 'NR==2 {print int($4/1024/1024)}')
if [ "$AVAILABLE_GB" -lt 15 ]; then
  log_warning "Low disk space detected: ${AVAILABLE_GB}GB available"
  log_warning "Recommended: at least 15GB free space"
  log_note "Continuing anyway, but installation may fail due to insufficient space..."
else
  log_success "Sufficient disk space available: ${AVAILABLE_GB}GB"
fi

# Check internet connectivity (skip strict check in Docker environments)
# In Docker builds, ping may not work due to network restrictions,
# but package installation will work. We'll let apt operations fail
# naturally if there's truly no internet connectivity.
if ping -c 1 -W 5 google.com &>/dev/null; then
  log_success "Internet connectivity confirmed"
else
  log_warning "Ping test failed (may be expected in Docker environments)"
  log_note "Internet connectivity will be verified during package installation"
fi

log_success "Pre-flight checks passed"

log_step "Starting hive environment setup"

# --- Create hive user if missing ---
if id "hive" &>/dev/null; then
  log_info "hive user already exists."
else
  log_info "Creating hive user..."
  # Use useradd (always available) instead of adduser (requires package installation)
  useradd -m -s /bin/bash hive 2>/dev/null || {
    log_warning "User creation with useradd failed, trying adduser..."
    # Fallback to adduser if available
    adduser --disabled-password --gecos "" hive
  }
  # Remove password requirement
  passwd -d hive 2>/dev/null || log_note "Could not remove password requirement"
  # Add to sudo group
  usermod -aG sudo hive 2>/dev/null || log_note "Could not add to sudo group"
  log_success "hive user created and configured"
fi

# --- Function: apt safe update ---
apt_update_safe() {
  log_info "Updating apt sources..."
  for f in /etc/apt/sources.list.d/*.list; do
    if [ -f "$f" ] && ! grep -Eq "^deb " "$f"; then
      log_warning "Removing malformed apt source: $f"
      maybe_sudo rm -f "$f"
    fi
  done
  maybe_sudo apt update -y || true
}

# --- Function: cleanup disk ---
apt_cleanup() {
  log_info "Cleaning up apt cache and temporary files..."
  maybe_sudo apt-get clean
  maybe_sudo apt-get autoclean
  maybe_sudo apt-get autoremove -y
  maybe_sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
  log_success "Cleanup completed"
}

# --- Function: create swap file ---
create_swap_file() {
  log_info "Setting up 2GB total swap space..."

  local target_total_mb=2048  # 2GB target
  local current_total_mb=0

  # Function to get file size in MB
  get_file_size_mb() {
    local file="$1"
    if [ -f "$file" ]; then
      local size_bytes=$(stat -c%s "$file" 2>/dev/null || echo "0")
      echo $((size_bytes / 1024 / 1024))
    else
      echo "0"
    fi
  }

  # Check existing swap files and calculate total
  log_info "Checking existing swap configuration..."
  for i in "" 1 2 3 4 5; do
    local swapfile="/swapfile$i"
    if [ -f "$swapfile" ]; then
      local size_mb=$(get_file_size_mb "$swapfile")
      current_total_mb=$((current_total_mb + size_mb))
      log_info "Found $swapfile: ${size_mb}MB"

      # Activate if not already active
      if ! swapon --show | grep -q "$swapfile"; then
        log_info "Activating $swapfile..."
        maybe_sudo swapon "$swapfile" || true
      fi
    fi
  done

  log_info "Current total swap: ${current_total_mb}MB, Target: ${target_total_mb}MB"

  # If we already have enough swap, we're done
  if [ "$current_total_mb" -ge "$target_total_mb" ]; then
    log_success "Already have sufficient swap space (${current_total_mb}MB >= ${target_total_mb}MB)"
    return 0
  fi

  # Calculate how much additional swap we need
  local needed_mb=$((target_total_mb - current_total_mb))
  log_info "Need to create ${needed_mb}MB additional swap space..."

  # Check available disk space (need extra margin for safety)
  local available_space_kb=$(df / | awk 'NR==2 {print $4}')
  local needed_space_kb=$((needed_mb * 1024 + 1024 * 1024))  # needed + 1GB safety margin

  if [ "$available_space_kb" -lt "$needed_space_kb" ]; then
    log_error "Insufficient disk space for additional swap. Available: $(($available_space_kb/1024/1024))GB, Needed: $(($needed_space_kb/1024/1024))GB"
    return 1
  fi

  # Find next available swap file name
  local new_swapfile=""
  for i in "" 1 2 3 4 5; do
    local candidate="/swapfile$i"
    if [ ! -f "$candidate" ]; then
      new_swapfile="$candidate"
      break
    fi
  done

  if [ -z "$new_swapfile" ]; then
    log_error "Cannot find available swap file name (checked /swapfile through /swapfile5)"
    return 1
  fi

  # Create additional swap file
  log_info "Creating ${needed_mb}MB swap file at $new_swapfile..."
  if command -v fallocate >/dev/null 2>&1; then
    maybe_sudo fallocate -l "${needed_mb}M" "$new_swapfile"
  else
    # Fallback to dd if fallocate is not available
    maybe_sudo dd if=/dev/zero of="$new_swapfile" bs=1M count="$needed_mb" status=progress
  fi

  # Set proper permissions
  maybe_sudo chmod 600 "$new_swapfile"

  # Format as swap
  maybe_sudo mkswap "$new_swapfile"

  # Enable swap file (may fail in Docker containers)
  if ! maybe_sudo swapon "$new_swapfile" 2>/dev/null; then
    log_warning "Failed to enable swap file (likely running in Docker container)"
    log_note "Swap creation will be skipped. Docker manages swap at the host level."
    # Clean up the swap file we tried to create
    maybe_sudo rm -f "$new_swapfile"
    return 0
  fi

  # Make it persistent by adding to /etc/fstab if not already there
  if ! grep -q "$new_swapfile" /etc/fstab; then
    log_info "Adding $new_swapfile to /etc/fstab for persistence..."
    # Ensure we have a backup of fstab
    if [ ! -f /etc/fstab.backup ]; then
      maybe_sudo cp /etc/fstab /etc/fstab.backup
    fi
    echo "$new_swapfile none swap sw 0 0" | maybe_sudo tee -a /etc/fstab >/dev/null
  fi

  # Verify swap is active and show final status
  if swapon --show | grep -q "$new_swapfile"; then
    log_success "Swap file $new_swapfile successfully created and activated"
    log_info "Final swap configuration:"
    swapon --show
    log_info "Total swap space: $((current_total_mb + needed_mb))MB"

    # Optimize swappiness for development workload
    if [ "$(cat /proc/sys/vm/swappiness)" -gt 10 ]; then
      log_info "Optimizing swap usage (setting swappiness to 10 for development workload)..."
      echo "vm.swappiness=10" | maybe_sudo tee -a /etc/sysctl.conf >/dev/null
      maybe_sudo sysctl -w vm.swappiness=10 >/dev/null
      log_success "Swap settings optimized"
    fi
  else
    log_error "Swap file creation failed"
    return 1
  fi
}

# --- Ensure prerequisites ---
log_step "Installing system prerequisites"
apt_update_safe

log_info "Installing essential development tools..."
maybe_sudo apt install -y wget curl unzip git sudo ca-certificates gnupg dotnet-sdk-8.0 build-essential expect
log_success "Essential tools installed"

# --- Install Python build dependencies (required for pyenv) ---
log_info "Installing Python build dependencies..."
maybe_sudo apt install -y \
  libssl-dev \
  zlib1g-dev \
  libbz2-dev \
  libreadline-dev \
  libsqlite3-dev \
  libncursesw5-dev \
  xz-utils \
  tk-dev \
  libxml2-dev \
  libxmlsec1-dev \
  libffi-dev \
  liblzma-dev
log_success "Python build dependencies installed"

# --- GitHub CLI (install system-wide before switching to hive user) ---
log_step "Installing GitHub CLI (system-wide)"
if ! command -v gh &>/dev/null; then
  log_info "Installing GitHub CLI..."
  # Use official installation method from GitHub CLI maintainers
  maybe_sudo mkdir -p -m 755 /etc/apt/keyrings
  out=$(mktemp)
  wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg
  cat "$out" | maybe_sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
  maybe_sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  rm -f "$out"

  maybe_sudo mkdir -p -m 755 /etc/apt/sources.list.d
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | maybe_sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null

  maybe_sudo apt update -y
  maybe_sudo apt install -y gh
  log_success "GitHub CLI installed"
else
  log_success "GitHub CLI already installed"
fi

# --- Setup swap file (skip in Docker) ---
# Docker containers cannot create swap files due to security restrictions
# Detection methods:
# 1. DOCKER_BUILD=1 environment variable (most reliable, passed from Dockerfile)
# 2. /.dockerenv file (exists in container runtime, not during build)
# 3. /proc/1/cgroup containing docker/buildkit
# 4. /run/systemd/container file containing "docker" (modern Docker)
is_docker=false
if [ "${DOCKER_BUILD:-}" = "1" ]; then
  # Explicit Docker build environment indicator (passed from Dockerfile RUN)
  is_docker=true
  log_note "Docker build environment detected via DOCKER_BUILD variable"
elif [ -f /.dockerenv ]; then
  is_docker=true
elif grep -qE 'docker|buildkit|containerd' /proc/1/cgroup 2>/dev/null; then
  is_docker=true
elif [ -f /run/systemd/container ] && grep -qE '^docker$' /run/systemd/container 2>/dev/null; then
  is_docker=true
fi

if [ "$is_docker" = true ]; then
  log_step "Skipping swap setup (running in Docker container)"
  log_note "Swap is managed by the Docker host"
else
  log_step "Setting up swap space"
  create_swap_file
fi

# --- Prepare Homebrew directory ---
# Homebrew's installer has strict permission checks that require the directory
# to be owned by the installing user. Pre-create the directory with proper
# ownership before running the installer.
# This is needed in both Docker and regular Ubuntu environments when running
# as root and then switching to the hive user.
log_step "Preparing Homebrew installation directory"

if [ ! -d /home/linuxbrew/.linuxbrew ]; then
  log_info "Creating /home/linuxbrew/.linuxbrew directory"
  # Create the parent directory first if needed
  maybe_sudo mkdir -p /home/linuxbrew
  maybe_sudo mkdir -p /home/linuxbrew/.linuxbrew

  # Set ownership to hive user so Homebrew installer can write to it
  if id "hive" &>/dev/null; then
    maybe_sudo chown -R hive:hive /home/linuxbrew
    log_success "Homebrew directory created and owned by hive user"
  else
    log_warning "hive user not found, directory created but ownership not set"
  fi
else
  log_info "Homebrew directory already exists"
  # Ensure proper ownership for the hive user
  if id "hive" &>/dev/null; then
    maybe_sudo chown -R hive:hive /home/linuxbrew
    log_note "Ensured proper ownership for hive user"
  fi
fi

# --- Switch to hive user for language tools and gh setup ---
# Write the hive user setup script to a temporary file
cat > /tmp/hive-user-setup.sh <<'EOF_HIVE_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

# Define logging functions for hive user session
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; NC=''
fi

log_info() { echo -e "${BLUE}[*]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_note() { echo -e "${CYAN}[i]${NC} $1"; }
log_step() { echo -e "\n${GREEN}==>${NC} ${BLUE}$1${NC}\n"; }

# Check if a command exists (silent)
command_exists() {
  command -v "$1" &>/dev/null
}

# Run command with sudo only if not root and sudo is available
# This function is needed for operations that require elevated privileges
# (e.g., installing Playwright OS dependencies)
maybe_sudo() {
  if [ "$EUID" -eq 0 ]; then
    # Running as root, execute directly
    "$@"
  elif command_exists sudo; then
    # Not root but sudo available
    sudo "$@"
  else
    # Not root and sudo not available - try directly (will fail if permissions needed)
    "$@"
  fi
}

log_step "Installing development tools as hive user"

# --- GitHub CLI Authentication Note ---
# Note: GitHub CLI is already installed system-wide.
# Authentication should be performed AFTER the Docker image is installed,
# especially when running in Docker to avoid build timeouts.
# To authenticate after installation, run:
#   gh auth login -h github.com -s repo,workflow,user,read:org,gist

# --- Bun ---
if ! command -v bun &>/dev/null; then
  log_info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  log_success "Bun installed"
else
  log_info "Bun already installed."
fi

# --- NVM + Node ---
if [ ! -d "$HOME/.nvm" ]; then
  log_info "Installing NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  log_success "NVM installed"
else
  log_info "NVM already installed."
fi

# --- Pyenv (Python version manager) ---
if [ ! -d "$HOME/.pyenv" ]; then
  log_info "Installing Pyenv..."
  log_note "Pyenv installer may show a warning about load path - this is expected and will be configured"
  curl https://pyenv.run | bash
  # Add pyenv to shell profile for persistence
  if ! grep -q 'pyenv init' "$HOME/.bashrc" 2>/dev/null; then
    log_info "Adding Pyenv to shell configuration..."
    {
      echo ''
      echo '# Pyenv configuration'
      echo 'export PYENV_ROOT="$HOME/.pyenv"'
      echo 'export PATH="$PYENV_ROOT/bin:$PATH"'
      echo 'eval "$(pyenv init --path)"'
      echo 'eval "$(pyenv init -)"'
    } >> "$HOME/.bashrc"
  fi
  log_success "Pyenv installed and configured"
else
  log_info "Pyenv already installed."
fi

# Load pyenv for current session
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
if command -v pyenv >/dev/null 2>&1; then
  eval "$(pyenv init --path)"
  eval "$(pyenv init -)"
  log_success "Pyenv loaded for current session"

  # Install latest stable Python version
  log_info "Installing latest stable Python version..."
  LATEST_PYTHON=$(pyenv install --list | grep -E '^\s*[0-9]+\.[0-9]+\.[0-9]+$' | tail -1 | tr -d '[:space:]')

  if [ -n "$LATEST_PYTHON" ]; then
    log_info "Installing Python $LATEST_PYTHON..."
    if ! pyenv versions --bare | grep -q "^${LATEST_PYTHON}$"; then
      pyenv install "$LATEST_PYTHON"
    else
      log_info "Python $LATEST_PYTHON already installed."
    fi

    # Set as global default
    log_info "Setting Python $LATEST_PYTHON as global default..."
    pyenv global "$LATEST_PYTHON"

    log_success "Python version manager setup complete"
    python --version
  else
    log_warning "Could not determine latest Python version. Skipping Python installation."
  fi
else
  log_warning "Pyenv installation may have failed. Skipping Python setup."
fi

# --- Rust ---
if [ ! -d "$HOME/.cargo" ]; then
  log_info "Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  if [ -f "$HOME/.cargo/env" ]; then
    \. "$HOME/.cargo/env"
    log_success "Rust installed successfully"
  else
    log_warning "Rust installation may have failed or been cancelled. Skipping Rust environment setup."
  fi
else
  log_info "Rust already installed."
fi

# --- Homebrew ---
if ! command -v brew &>/dev/null; then
  log_info "Installing Homebrew..."
  log_note "Homebrew will be configured for current session and persist after shell restart"

  # Check if directory was pre-created (happens in Docker environments)
  if [ -d /home/linuxbrew/.linuxbrew ]; then
    log_note "Homebrew directory already exists (pre-created for Docker compatibility)"
  fi

  # Run Homebrew installation script with error detection
  log_info "Running Homebrew installer..."

  # Capture output and exit code separately
  BREW_INSTALL_OUTPUT=$(NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" 2>&1) || BREW_EXIT_CODE=$?
  BREW_EXIT_CODE=${BREW_EXIT_CODE:-0}

  # Check for critical errors in output
  if echo "$BREW_INSTALL_OUTPUT" | grep -qi "insufficient permissions\|permission denied\|failed"; then
    log_error "Homebrew installation encountered errors:"
    echo "$BREW_INSTALL_OUTPUT" | grep -i "error\|insufficient\|permission\|failed" || true
    log_warning "Homebrew installation may have failed. Checking if installation succeeded anyway..."
  fi

  # Verify Homebrew was actually installed by checking for the binary
  BREW_INSTALLED=false
  if [[ -x /home/linuxbrew/.linuxbrew/bin/brew ]]; then
    BREW_INSTALLED=true
    BREW_PREFIX="/home/linuxbrew/.linuxbrew"
  elif [[ -x "$HOME/.linuxbrew/bin/brew" ]]; then
    BREW_INSTALLED=true
    BREW_PREFIX="$HOME/.linuxbrew"
  fi

  if [ "$BREW_INSTALLED" = true ]; then
    log_success "Homebrew successfully installed at $BREW_PREFIX"

    # Evaluate shellenv for current session
    eval "$($BREW_PREFIX/bin/brew shellenv)"

    # Add to shell configuration files for persistence
    if ! grep -q "$BREW_PREFIX/bin/brew shellenv" "$HOME/.profile" 2>/dev/null; then
      echo "eval \"\$($BREW_PREFIX/bin/brew shellenv)\"" >> "$HOME/.profile"
    fi
    if ! grep -q "$BREW_PREFIX/bin/brew shellenv" "$HOME/.bashrc" 2>/dev/null; then
      echo "eval \"\$($BREW_PREFIX/bin/brew shellenv)\"" >> "$HOME/.bashrc"
    fi

    # Verify brew command is accessible
    if command -v brew &>/dev/null; then
      BREW_VERSION=$(brew --version 2>/dev/null | head -n1 || echo "version check failed")
      log_success "Homebrew ready: $BREW_VERSION"
    else
      log_warning "Homebrew installed but not yet in PATH for current session"
      log_note "Will be available after: source ~/.bashrc"
    fi
  else
    log_error "Homebrew installation failed - binary not found"
    log_note "PHP installation will be skipped"
    log_note "Check installation log above for errors"
  fi
else
  log_info "Homebrew already installed."
  # Ensure Homebrew is loaded in current session
  eval "$(brew shellenv 2>/dev/null)" || true

  # Verify it's accessible
  if command -v brew &>/dev/null; then
    BREW_VERSION=$(brew --version 2>/dev/null | head -n 1 || echo "version unknown")
    log_success "Homebrew ready: $BREW_VERSION"
  fi
fi

# --- PHP (via Homebrew + shivammathur/php tap) ---
if command -v brew &>/dev/null; then
  # Check if PHP is already installed via Homebrew
  # Note: brew list outputs formula names without the tap prefix, e.g., "php@8.3"
  if ! brew list --formula 2>/dev/null | grep -q "^php@"; then
    log_info "Installing PHP via Homebrew..."

    # Add shivammathur/php tap
    if ! brew tap | grep -q "shivammathur/php"; then
      log_info "Adding shivammathur/php tap..."
      brew tap shivammathur/php || {
        log_warning "Failed to add shivammathur/php tap. Skipping PHP installation."
      }
    else
      log_info "shivammathur/php tap already added."
    fi

    # Install PHP 8.3 if tap was successfully added
    if brew tap | grep -q "shivammathur/php"; then
      log_info "Installing PHP 8.3 (this may take several minutes)..."
      brew install shivammathur/php/php@8.3 || {
        log_warning "PHP 8.3 installation failed."
      }

      # Link PHP 8.3 as the active version if installation succeeded
      # Check for php@8.3 in brew list (formula name, not tap prefix)
      if brew list --formula 2>/dev/null | grep -q "^php@8.3$"; then
        log_info "Linking PHP 8.3 as the active version..."
        brew link --overwrite --force shivammathur/php/php@8.3 2>&1 | grep -v "Warning" || true

        # Determine the correct Homebrew prefix (system-wide or user-local)
        BREW_PREFIX=""
        if [[ -d /home/linuxbrew/.linuxbrew ]]; then
          BREW_PREFIX="/home/linuxbrew/.linuxbrew"
        elif [[ -d "$HOME/.linuxbrew" ]]; then
          BREW_PREFIX="$HOME/.linuxbrew"
        else
          # Fallback: try to get it from brew itself
          BREW_PREFIX=$(brew --prefix 2>/dev/null || echo "")
        fi

        # Explicitly add PHP to PATH for current session
        # PHP is keg-only and won't be in PATH unless we add it explicitly
        if [[ -n "$BREW_PREFIX" && -d "$BREW_PREFIX/opt/php@8.3" ]]; then
          # Add to beginning of PATH to ensure it takes precedence
          export PATH="$BREW_PREFIX/opt/php@8.3/bin:$BREW_PREFIX/opt/php@8.3/sbin:$PATH"

          # Rehash the command cache to ensure bash picks up the new PHP binary
          hash -r 2>/dev/null || true

          log_success "PHP paths added to current session"
          log_note "Current PATH includes: $BREW_PREFIX/opt/php@8.3/bin"

          # Add PHP to PATH in shell configuration for future sessions
          if ! grep -q "php@8.3/bin" "$HOME/.bashrc" 2>/dev/null; then
            cat >> "$HOME/.bashrc" << 'PHP_PATH_EOF'

# PHP 8.3 PATH configuration
export PATH="$(brew --prefix)/opt/php@8.3/bin:$(brew --prefix)/opt/php@8.3/sbin:$PATH"
PHP_PATH_EOF
            log_info "PHP paths added to .bashrc for future sessions"
          fi
        else
          log_warning "Could not determine Homebrew prefix for PHP PATH configuration"
        fi

        # Verify PHP installation in current session
        if command -v php &>/dev/null; then
          PHP_VERSION=$(php --version 2>/dev/null | head -n 1 || echo "unknown version")
          log_success "PHP installed and available: $PHP_VERSION"
        else
          # Check if binary exists but is not in PATH
          if [[ -n "$BREW_PREFIX" && -x "$BREW_PREFIX/opt/php@8.3/bin/php" ]]; then
            PHP_VERSION=$("$BREW_PREFIX/opt/php@8.3/bin/php" --version 2>/dev/null | head -n 1 || echo "unknown version")
            log_warning "PHP installed but not immediately available in PATH"
            log_note "PHP version: $PHP_VERSION"
            log_note "PHP binary location: $BREW_PREFIX/opt/php@8.3/bin/php"
            log_note "PHP will be available after shell restart or: source ~/.bashrc"
          else
            log_warning "PHP installation could not be verified"
          fi
        fi
      else
        log_warning "PHP 8.3 installation appears to have failed - not found in brew list"
      fi
    fi

    # Create a helper function for switching PHP versions
    if ! grep -q "switch-php()" "$HOME/.bashrc" 2>/dev/null; then
      log_info "Adding switch-php helper function to .bashrc..."
      cat >> "$HOME/.bashrc" << 'PHP_SWITCH_EOF'

# PHP version switcher function
switch-php() {
  if [[ -z "$1" ]]; then
    echo "Usage: switch-php <version>"
    echo "Example: switch-php 8.3"
    return 1
  fi

  # Unlink all PHP versions
  for php_ver in $(brew list --formula 2>/dev/null | grep -E '^php@'); do
    brew unlink "$php_ver" 2>/dev/null || true
  done

  # Link the requested version
  brew link --overwrite --force "shivammathur/php/php@$1" && \
    echo "Switched to PHP $(php --version | head -n 1)"
}
PHP_SWITCH_EOF
      log_success "switch-php helper function added to .bashrc"
    else
      log_info "switch-php function already exists in .bashrc"
    fi

  else
    log_info "PHP already installed via Homebrew."
    # Ensure PHP is in PATH even if already installed
    eval "$(brew shellenv 2>/dev/null)" || true
    BREW_PREFIX=$(brew --prefix 2>/dev/null || echo "")
    if [[ -n "$BREW_PREFIX" && -d "$BREW_PREFIX/opt/php@8.3" ]]; then
      # Add to beginning of PATH to ensure it takes precedence
      export PATH="$BREW_PREFIX/opt/php@8.3/bin:$BREW_PREFIX/opt/php@8.3/sbin:$PATH"

      # Rehash the command cache to ensure bash picks up the PHP binary
      hash -r 2>/dev/null || true

      log_note "PHP paths added to current session"
    fi
  fi
else
  log_warning "Homebrew not available. Skipping PHP installation."
fi

export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Ensure Node 20 is installed and active
if ! nvm ls 20 | grep -q 'v20'; then
  log_info "Installing Node.js 20..."
  nvm install 20
  log_success "Node.js 20 installed"
else
  log_info "Node.js 20 already installed"
fi
nvm use 20

# Update npm to latest version
log_info "Updating npm to latest version..."
npm install -g npm@latest --no-fund --silent
log_success "npm updated to latest version"

# --- Install Playwright OS dependencies first (as root via absolute npx path) ---
log_info "Installing Playwright OS dependencies (requires sudo, may take a few minutes)..."
NPX_PATH="$(command -v npx || true)"
if [ -z "$NPX_PATH" ]; then
  log_error "npx not found after Node setup; aborting Playwright deps install."
else
  # Ensure root sees the same Node as hive by exporting PATH with node's bin dir
  NODE_BIN_DIR="$(dirname "$(command -v node)")"
  log_note "Using npx to install Playwright system dependencies..."

  # Suppress expected npm exec warning and funding notices
  maybe_sudo env "PATH=$NODE_BIN_DIR:$PATH" "$NPX_PATH" playwright@latest install-deps 2>&1 | \
    grep -v "npm warn exec" | \
    grep -v "packages are looking for funding" || {
    log_warning "'npx playwright install-deps' failed. You may need to install deps manually."
  }

  log_success "Playwright OS dependencies installed"
fi

# --- Global bun packages ---
log_info "Installing global bun packages (this may take a few minutes)..."
bun install -g @deep-assistant/hive-mind @deep-assistant/claude-profiles @anthropic-ai/claude-code @openai/codex @qwen-code/qwen-code @google/gemini-cli @github/copilot opencode-ai @link-assistant/agent

# Check for blocked postinstall scripts
log_info "Checking for blocked postinstall scripts..."
BLOCKED_OUTPUT=$(bun pm -g untrusted 2>/dev/null || echo "")
if [ -n "$BLOCKED_OUTPUT" ]; then
  log_note "Some packages have blocked postinstall scripts (security feature):"
  echo "$BLOCKED_OUTPUT"
  log_note "If any functionality is missing, run: bun pm -g trust"
else
  log_success "All global packages installed without blocked scripts"
fi

# --- Install Playwright MCP ---
log_info "Installing Playwright MCP server..."
if npm list -g @playwright/mcp &>/dev/null; then
  log_info "Playwright MCP already installed, updating..."
  npm update -g @playwright/mcp --no-fund --silent
else
  log_info "Installing Playwright MCP package..."
  npm install -g @playwright/mcp --no-fund --silent
fi
log_success "Playwright MCP installed"

# --- Now install Playwright browsers (after deps to avoid warnings) ---
log_info "Installing Playwright browsers (chromium, firefox, webkit)..."
log_note "This may take several minutes depending on network speed..."

# Ensure CLI exists so we don't get the npx "install without dependencies" banner
if ! command -v playwright >/dev/null 2>&1; then
  log_info "Installing Playwright CLI globally..."
  npm install -g @playwright/test --no-fund --silent
fi

playwright install chromium firefox webkit 2>&1 | grep -E "(Downloading|downloaded|Installing)" || {
  log_warning "Failed to install some Playwright browsers. This may affect browser automation."
}
log_success "Playwright browsers installed"

# --- Configure Playwright MCP for Claude CLI ---
log_info "Configuring Playwright MCP for Claude CLI..."
# Wait for Claude CLI to be available
if ! command -v claude &>/dev/null; then
  log_note "Claude CLI not found. Waiting for installation to complete..."
  sleep 2
fi

# Check if Claude CLI is available now
if command -v claude &>/dev/null; then
  # Check if playwright MCP is already configured
  if claude mcp list 2>/dev/null | grep -q "playwright"; then
    log_info "Playwright MCP already configured in Claude CLI, removing old configuration..."
    claude mcp remove playwright 2>/dev/null || log_warning "Could not remove old Playwright MCP configuration"
  fi

  # Add the playwright MCP server to Claude CLI configuration with user scope
  # Using -s user ensures it's available for all tasks in all folders
  # Configuration flags:
  # - @latest: Use latest version (currently 0.0.49)
  # - --isolated: Ephemeral browser contexts (prevents memory leaks)
  # - --headless: Reduces UI memory overhead
  # - --no-sandbox: Required for server/container environments
  # - --timeout-action=600000: 10-minute timeout to prevent hung processes
  log_info "Adding Playwright MCP to Claude CLI configuration (user scope with recommended flags)..."
  claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 2>/dev/null || {
    log_warning "Could not add Playwright MCP to Claude CLI."
    log_note "You may need to run manually: claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000"
  }

  # Verify the configuration
  if claude mcp get playwright 2>/dev/null | grep -q "playwright"; then
    log_success "Playwright MCP successfully configured"
  else
    log_warning "Playwright MCP configuration could not be verified"
  fi
else
  log_warning "Claude CLI is not available. Skipping MCP configuration."
  log_note "After Claude CLI is installed, run: claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000"
fi

# --- Git setup with GitHub identity (only if authenticated) ---
if gh auth status &>/dev/null; then
  log_info "Configuring Git with GitHub identity..."
  git config --global user.name "$(gh api user --jq .login)"
  git config --global user.email "$(gh api user/emails --jq '.[] | select(.primary==true).email')"
  gh auth setup-git
  log_success "Git configured with GitHub identity"
else
  log_note "GitHub CLI not authenticated - skipping Git configuration"
  log_note "After authentication, Git will be auto-configured with your GitHub identity"
fi

# --- Clone or update hive-mind repo (idempotent, no fatal logs) ---
REPO_DIR="$HOME/hive-mind"
if [ -d "$REPO_DIR/.git" ]; then
  log_info "Updating existing hive-mind repository..."
  git -C "$REPO_DIR" fetch --all --prune || log_warning "fetch failed (continuing)."
  git -C "$REPO_DIR" pull --ff-only || log_warning "pull failed (continuing)."
elif [ -d "$REPO_DIR" ]; then
  log_warning "Directory '$REPO_DIR' exists but is not a git repo; skipping clone."
else
  log_info "Cloning hive-mind repository..."
  (cd "$HOME" && git clone https://github.com/deep-assistant/hive-mind) || log_warning "clone failed (continuing)."
  log_success "hive-mind repository cloned"
fi

# --- Generate Installation Summary ---
log_step "Installation Summary"

echo ""
echo "System & Development Tools:"
if command -v gh &>/dev/null; then log_success "GitHub CLI: $(gh --version | head -n1)"; else log_warning "GitHub CLI: not found"; fi
if command -v git &>/dev/null; then log_success "Git: $(git --version)"; else log_warning "Git: not found"; fi
if command -v bun &>/dev/null; then log_success "Bun: $(bun --version)"; else log_warning "Bun: not found"; fi
if command -v node &>/dev/null; then log_success "Node.js: $(node --version)"; else log_warning "Node.js: not found"; fi
if command -v npm &>/dev/null; then log_success "NPM: $(npm --version)"; else log_warning "NPM: not found"; fi
if command -v python &>/dev/null; then log_success "Python: $(python --version)"; else log_warning "Python: not found"; fi
if command -v pyenv &>/dev/null; then log_success "Pyenv: $(pyenv --version)"; else log_warning "Pyenv: not found"; fi
if command -v rustc &>/dev/null; then log_success "Rust: $(rustc --version)"; else log_warning "Rust: not found"; fi
if command -v cargo &>/dev/null; then log_success "Cargo: $(cargo --version)"; else log_warning "Cargo: not found"; fi
if command -v brew &>/dev/null; then
  BREW_VERSION=$(brew --version 2>/dev/null | head -n1 || echo "version unknown")
  log_success "Homebrew: $BREW_VERSION"
else
  log_warning "Homebrew: not found"
fi

if command -v php &>/dev/null; then
  PHP_VERSION=$(php --version 2>/dev/null | head -n1 || echo "unknown version")
  log_success "PHP: $PHP_VERSION"
else
  # Try to find PHP in common Homebrew locations
  PHP_FOUND=false
  for PHP_PATH in "/home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php" "$HOME/.linuxbrew/opt/php@8.3/bin/php"; do
    if [ -x "$PHP_PATH" ]; then
      PHP_VERSION=$("$PHP_PATH" --version 2>/dev/null | head -n1 || echo "unknown version")
      log_warning "PHP: installed but not in current PATH"
      log_note "PHP version: $PHP_VERSION"
      log_note "PHP binary location: $PHP_PATH"
      log_note "PHP will be available after shell restart or: source ~/.bashrc"
      PHP_FOUND=true
      break
    fi
  done

  if [ "$PHP_FOUND" = false ]; then
    log_warning "PHP: not found"
  fi
fi
if command -v playwright &>/dev/null; then log_success "Playwright: $(playwright --version)"; else log_warning "Playwright: not found"; fi

echo ""
echo "Swap Configuration:"
if command -v swapon &>/dev/null; then
  swapon --show 2>/dev/null || echo "No swap configured"
fi

echo ""
echo "GitHub Authentication:"
log_note "GitHub CLI is installed but not authenticated during setup"
log_note "This is intentional to support Docker builds without timeouts"
log_note "After installation, authenticate with: gh auth login -h github.com -s repo,workflow,user,read:org,gist"

echo ""
echo "Next Steps:"
log_note "1. Authenticate with GitHub: gh auth login -h github.com -s repo,workflow,user,read:org,gist"
log_note "2. Authenticate with Claude: Run 'claude' command and follow the prompts"
log_note "3. Restart your shell or run: source ~/.bashrc"
log_note "4. Verify installations with: <tool> --version"
log_note "5. Navigate to ~/hive-mind to start working"

echo ""

EOF_HIVE_SCRIPT

# Make the script executable
chmod +x /tmp/hive-user-setup.sh

# Execute as hive user (use su if root, sudo otherwise)
if [ "$EUID" -eq 0 ]; then
  # Running as root - use su
  su - hive -c "bash /tmp/hive-user-setup.sh"
else
  # Not root - use sudo
  sudo -i -u hive bash /tmp/hive-user-setup.sh
fi

# Clean up the temporary script
rm -f /tmp/hive-user-setup.sh

# --- Cleanup after everything (so install-deps/apt had full cache) ---
log_step "Cleaning up"
apt_cleanup

log_step "Setup complete!"
log_success "All components installed successfully"
log_note "Please restart your shell or run: source ~/.bashrc"
