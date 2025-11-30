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

# Check internet connectivity
if ! ping -c 1 -W 5 google.com &>/dev/null; then
  log_warning "No internet connectivity detected"
  log_error "Internet connection required for installation"
  exit 1
fi

log_success "Internet connectivity confirmed"
log_success "Pre-flight checks passed"

log_step "Starting hive environment setup"

# --- Create hive user if missing ---
if id "hive" &>/dev/null; then
  log_info "hive user already exists."
else
  log_info "Creating hive user..."
  adduser --disabled-password --gecos "" hive
  passwd -d hive
  usermod -aG sudo hive
  log_success "hive user created and configured"
fi

# --- Function: apt safe update ---
apt_update_safe() {
  log_info "Updating apt sources..."
  for f in /etc/apt/sources.list.d/*.list; do
    if [ -f "$f" ] && ! grep -Eq "^deb " "$f"; then
      log_warning "Removing malformed apt source: $f"
      sudo rm -f "$f"
    fi
  done
  sudo apt update -y || true
}

# --- Function: cleanup disk ---
apt_cleanup() {
  log_info "Cleaning up apt cache and temporary files..."
  sudo apt-get clean
  sudo apt-get autoclean
  sudo apt-get autoremove -y
  sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
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
        sudo swapon "$swapfile" || true
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
    sudo fallocate -l "${needed_mb}M" "$new_swapfile"
  else
    # Fallback to dd if fallocate is not available
    sudo dd if=/dev/zero of="$new_swapfile" bs=1M count="$needed_mb" status=progress
  fi

  # Set proper permissions
  sudo chmod 600 "$new_swapfile"

  # Format as swap
  sudo mkswap "$new_swapfile"

  # Enable swap file
  sudo swapon "$new_swapfile"

  # Make it persistent by adding to /etc/fstab if not already there
  if ! grep -q "$new_swapfile" /etc/fstab; then
    log_info "Adding $new_swapfile to /etc/fstab for persistence..."
    # Ensure we have a backup of fstab
    if [ ! -f /etc/fstab.backup ]; then
      sudo cp /etc/fstab /etc/fstab.backup
    fi
    echo "$new_swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
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
      echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf >/dev/null
      sudo sysctl -w vm.swappiness=10 >/dev/null
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
sudo apt install -y wget curl unzip git sudo ca-certificates gnupg dotnet-sdk-8.0 build-essential
log_success "Essential tools installed"

# --- Install Python build dependencies (required for pyenv) ---
log_info "Installing Python build dependencies..."
sudo apt install -y \
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

# --- Setup swap file ---
log_step "Setting up swap space"
create_swap_file

# --- Switch to hive user for language tools and gh setup ---
sudo -i -u hive bash <<'EOF_HIVE'
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

log_step "Installing development tools as hive user"

# --- GitHub CLI ---
if ! command -v gh &>/dev/null; then
  log_info "Installing GitHub CLI..."
  # Use official installation method from GitHub CLI maintainers
  sudo mkdir -p -m 755 /etc/apt/keyrings
  out=$(mktemp)
  wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg
  cat "$out" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  rm -f "$out"

  sudo mkdir -p -m 755 /etc/apt/sources.list.d
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null

  sudo apt update -y
  sudo apt install -y gh
  log_success "GitHub CLI installed"
else
  log_info "GitHub CLI already installed."
fi

# --- Run interactive GitHub login ---
if ! gh auth status &>/dev/null; then
  log_info "Launching GitHub auth login..."
  log_note "Follow the prompts to authenticate with GitHub"
  gh auth login -h github.com -s repo,workflow,user,read:org,gist
  log_success "GitHub authentication completed"
fi

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

# --- Golang ---
if [ ! -d "$HOME/.go" ] && [ ! -d "/usr/local/go" ]; then
  log_info "Installing Golang..."

  # Detect architecture
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) GO_ARCH="amd64" ;;
    aarch64) GO_ARCH="arm64" ;;
    armv7l) GO_ARCH="armv6l" ;;
    *)
      log_warning "Unsupported architecture: $ARCH. Skipping Go installation."
      GO_ARCH=""
      ;;
  esac

  if [ -n "$GO_ARCH" ]; then
    # Get latest stable Go version from golang.org
    log_info "Fetching latest Go version..."
    GO_VERSION=$(curl -sL 'https://go.dev/VERSION?m=text' | head -n1)

    if [ -n "$GO_VERSION" ]; then
      GO_TARBALL="${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
      GO_URL="https://go.dev/dl/${GO_TARBALL}"

      log_info "Downloading Go $GO_VERSION for $GO_ARCH..."
      TEMP_DIR=$(mktemp -d)
      curl -sL "$GO_URL" -o "$TEMP_DIR/$GO_TARBALL"

      # Install to user's home directory
      log_info "Installing Go to $HOME/.go..."
      mkdir -p "$HOME/.go"
      tar -xzf "$TEMP_DIR/$GO_TARBALL" -C "$HOME/.go" --strip-components=1
      rm -rf "$TEMP_DIR"

      # Add Go to shell profile for persistence
      if ! grep -q 'GOROOT.*\.go' "$HOME/.bashrc" 2>/dev/null; then
        log_info "Adding Go to shell configuration..."
        {
          echo ''
          echo '# Go configuration'
          echo 'export GOROOT="$HOME/.go"'
          echo 'export GOPATH="$HOME/go"'
          echo 'export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"'
        } >> "$HOME/.bashrc"
      fi

      # Load Go for current session
      export GOROOT="$HOME/.go"
      export GOPATH="$HOME/go"
      export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"

      # Create GOPATH directory
      mkdir -p "$GOPATH"

      if command -v go &>/dev/null; then
        log_success "Golang installed: $(go version)"
      else
        log_warning "Go installation completed but binary not found in PATH"
      fi
    else
      log_warning "Could not determine latest Go version. Skipping Go installation."
    fi
  fi
else
  log_info "Golang already installed."
  # Ensure Go is in PATH for current session
  if [ -d "$HOME/.go/bin" ]; then
    export GOROOT="$HOME/.go"
    export GOPATH="$HOME/go"
    export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"
  elif [ -d "/usr/local/go/bin" ]; then
    export PATH="/usr/local/go/bin:$PATH"
  fi
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

  # Install Homebrew prerequisites (if not already installed)
  sudo apt install -y build-essential procps file || {
    log_warning "Some Homebrew prerequisites may have failed to install."
  }

  # Run Homebrew installation script (suppress expected PATH warning)
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" 2>&1 | \
    grep -v "Warning.*not in your PATH" || {
    log_warning "Homebrew installation failed. Skipping PHP setup."
  }

  # Add Homebrew to PATH
  if [[ -d /home/linuxbrew/.linuxbrew ]]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> "$HOME/.profile"
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> "$HOME/.bashrc"
    log_success "Homebrew installed at /home/linuxbrew/.linuxbrew"
  elif [[ -d "$HOME/.linuxbrew" ]]; then
    eval "$($HOME/.linuxbrew/bin/brew shellenv)"
    echo 'eval "$($HOME/.linuxbrew/bin/brew shellenv)"' >> "$HOME/.profile"
    echo 'eval "$($HOME/.linuxbrew/bin/brew shellenv)"' >> "$HOME/.bashrc"
    log_success "Homebrew installed at $HOME/.linuxbrew"
  else
    log_warning "Homebrew installation directory not found."
  fi
else
  log_info "Homebrew already installed."
  eval "$(brew shellenv 2>/dev/null)" || true
fi

# Verify Homebrew is accessible
if command -v brew &>/dev/null; then
  log_success "Homebrew ready for current session"
else
  log_warning "Homebrew not accessible in current session - PHP installation may fail"
fi

# --- PHP (via Homebrew + shivammathur/php tap) ---
if command -v brew &>/dev/null; then
  # Check if PHP is already installed via Homebrew
  if ! brew list | grep -q "shivammathur/php/php@"; then
    log_info "Installing PHP via Homebrew..."

    # Add shivammathur/php tap
    brew tap shivammathur/php || {
      log_warning "Failed to add shivammathur/php tap. Skipping PHP installation."
    }

    # Install PHP 8.3
    if brew tap | grep -q "shivammathur/php"; then
      log_info "Installing PHP 8.3 (this may take several minutes)..."
      brew install shivammathur/php/php@8.3 || {
        log_warning "PHP 8.3 installation failed."
      }

      # Link PHP 8.3 as the active version
      if brew list | grep -q "shivammathur/php/php@8.3"; then
        log_info "Linking PHP 8.3 as the active version..."
        brew link --overwrite --force shivammathur/php/php@8.3 2>&1 | grep -v "Warning" || true

        # Explicitly add PHP to PATH for current session
        # This is necessary because PHP is keg-only and may not be symlinked by default
        export PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:$PATH"
        export PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:$PATH"

        log_success "PHP paths added to current session"

        # Verify PHP installation in current session
        if command -v php &>/dev/null; then
          log_success "PHP installed: $(php --version | head -n 1)"
        else
          log_warning "PHP installed but not immediately available in PATH"
          log_note "PHP binary location: /home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php"
          log_note "PHP will be available in new shell sessions via .bashrc configuration"
        fi
      fi
    fi

    # Create a helper function for switching PHP versions
    log_info "Adding switch-php helper function to bashrc..."
    cat >> "$HOME/.bashrc" << 'PHP_SWITCH_EOF'

# PHP version switcher function
switch-php() {
  if [[ -z "$1" ]]; then
    echo "Usage: switch-php <version>"
    echo "Example: switch-php 8.3"
    return 1
  fi

  # Unlink all PHP versions
  for php_ver in $(brew list 2>/dev/null | grep -E '^(shivammathur/php/)?php@'); do
    brew unlink "$php_ver" 2>/dev/null || true
  done

  # Link the requested version
  brew link --overwrite --force "shivammathur/php/php@$1" && \
    echo "Switched to PHP $(php --version | head -n 1)"
}
PHP_SWITCH_EOF

  else
    log_info "PHP already installed via Homebrew."
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
  sudo env "PATH=$NODE_BIN_DIR:$PATH" "$NPX_PATH" playwright@latest install-deps 2>&1 | \
    grep -v "npm warn exec" | \
    grep -v "packages are looking for funding" || {
    log_warning "'npx playwright install-deps' failed. You may need to install deps manually."
  }

  log_success "Playwright OS dependencies installed"
fi

# --- Global bun packages ---
log_info "Installing global bun packages (this may take a few minutes)..."
bun install -g @deep-assistant/hive-mind @deep-assistant/claude-profiles @anthropic-ai/claude-code @openai/codex @qwen-code/qwen-code @google/gemini-cli @github/copilot opencode-ai

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
    log_info "Playwright MCP already configured in Claude CLI"
  else
    # Add the playwright MCP server to Claude CLI configuration with user scope
    # Using -s user ensures it's available for all tasks in all folders
    log_info "Adding Playwright MCP to Claude CLI configuration (user scope)..."
    claude mcp add playwright -s user -- npx -y @playwright/mcp@latest 2>/dev/null || {
      log_warning "Could not add Playwright MCP to Claude CLI."
      log_note "You may need to run manually: claude mcp add playwright -s user -- npx -y @playwright/mcp@latest"
    }
  fi

  # Verify the configuration
  if claude mcp get playwright 2>/dev/null | grep -q "playwright"; then
    log_success "Playwright MCP successfully configured"
  else
    log_warning "Playwright MCP configuration could not be verified"
  fi
else
  log_warning "Claude CLI is not available. Skipping MCP configuration."
  log_note "After Claude CLI is installed, run: claude mcp add playwright -s user -- npx -y @playwright/mcp@latest"
fi

# --- Git setup with GitHub identity ---
log_info "Configuring Git with GitHub identity..."
git config --global user.name "$(gh api user --jq .login)"
git config --global user.email "$(gh api user/emails --jq '.[] | select(.primary==true).email')"
gh auth setup-git
log_success "Git configured with GitHub identity"

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
if command -v go &>/dev/null; then log_success "Go: $(go version)"; else log_warning "Go: not found"; fi
if command -v rustc &>/dev/null; then log_success "Rust: $(rustc --version)"; else log_warning "Rust: not found"; fi
if command -v cargo &>/dev/null; then log_success "Cargo: $(cargo --version)"; else log_warning "Cargo: not found"; fi
if command -v brew &>/dev/null; then log_success "Homebrew: $(brew --version | head -n1)"; else log_warning "Homebrew: not found"; fi
if command -v php &>/dev/null; then
  log_success "PHP: $(php --version | head -n1)"
elif [ -x "/home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php" ]; then
  log_warning "PHP: installed but not in current PATH"
  log_note "PHP version: $(/home/linuxbrew/.linuxbrew/opt/php@8.3/bin/php --version | head -n1)"
  log_note "PHP will be available after shell restart or: source ~/.bashrc"
else
  log_warning "PHP: not found"
fi
if command -v playwright &>/dev/null; then log_success "Playwright: $(playwright --version)"; else log_warning "Playwright: not found"; fi

echo ""
echo "Swap Configuration:"
if command -v swapon &>/dev/null; then
  swapon --show 2>/dev/null || echo "No swap configured"
fi

echo ""
echo "GitHub Authentication:"
if gh auth status &>/dev/null; then
  log_success "GitHub CLI authenticated"
else
  log_warning "GitHub CLI not authenticated - run 'gh auth login'"
fi

echo ""
echo "Next Steps:"
log_note "1. Restart your shell or run: source ~/.bashrc"
log_note "2. Verify installations with: <tool> --version"
log_note "3. Navigate to ~/hive-mind to start working"

echo ""

EOF_HIVE

# --- Cleanup after everything (so install-deps/apt had full cache) ---
log_step "Cleaning up"
apt_cleanup

log_step "Setup complete!"
log_success "All components installed successfully"
log_note "Please restart your shell or run: source ~/.bashrc"
