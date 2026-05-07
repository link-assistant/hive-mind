#!/usr/bin/env bash
set -euo pipefail

echo "====================================="
echo "Testing Homebrew + shivammathur/php"
echo "====================================="

# Test if we're running on Ubuntu/Linux
if [[ ! -f /etc/os-release ]]; then
  echo "[!] Error: Cannot detect OS. This script is for Ubuntu/Linux."
  exit 1
fi

source /etc/os-release
echo "[*] OS: $NAME $VERSION"

# Check if running as hive user (recommended) or root
echo "[*] Current user: $(whoami)"

# --- Install Homebrew if not present ---
if ! command -v brew &>/dev/null; then
  echo "[*] Homebrew not found. Installing Homebrew..."

  # Install prerequisites
  echo "[*] Installing Homebrew prerequisites..."
  if command -v apt &>/dev/null; then
    sudo apt update -y
    sudo apt install -y build-essential curl git procps file
  else
    echo "[!] Warning: apt not found. Make sure build-essential, curl, git are installed."
  fi

  # Run Homebrew installation script with sudo
  echo "[*] Running Homebrew installation script..."
  sudo -n true 2>/dev/null && HAS_SUDO=1 || HAS_SUDO=0

  if [ "$HAS_SUDO" = "1" ]; then
    # User has passwordless sudo, install to system location
    echo "[*] Installing to /home/linuxbrew/.linuxbrew (system-wide)..."
    sudo NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  else
    # No passwordless sudo, install to user's home directory
    echo "[*] No passwordless sudo, installing to $HOME/.linuxbrew (user-local)..."
    # Create directory structure first
    mkdir -p "$HOME/.linuxbrew"
    # Install to user directory by setting CI environment variable
    CI=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
      echo "[!] Error: Homebrew installation failed."
      exit 1
    }
  fi

  # Add Homebrew to PATH
  echo "[*] Adding Homebrew to PATH..."
  if [[ -d /home/linuxbrew/.linuxbrew ]]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.profile
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
  elif [[ -d "$HOME/.linuxbrew" ]]; then
    eval "$($HOME/.linuxbrew/bin/brew shellenv)"
    echo 'eval "$($HOME/.linuxbrew/bin/brew shellenv)"' >> ~/.profile
    echo 'eval "$($HOME/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
  else
    echo "[!] Error: Homebrew installation directory not found."
    exit 1
  fi
else
  echo "[*] Homebrew already installed."
  eval "$(brew shellenv)" 2>/dev/null || true
fi

# Verify Homebrew installation
echo "[*] Verifying Homebrew installation..."
brew --version

# Run brew doctor to check installation
echo "[*] Running brew doctor..."
brew doctor || echo "[!] Warning: brew doctor found some issues (may be non-critical)"

# --- Add shivammathur/php tap ---
echo "[*] Adding shivammathur/php tap..."
brew tap shivammathur/php

# --- Install PHP 8.3 ---
echo "[*] Installing PHP 8.3 via Homebrew..."
brew install shivammathur/php/php@8.3

# --- Link PHP 8.3 ---
echo "[*] Linking PHP 8.3..."
brew link --overwrite --force shivammathur/php/php@8.3

# --- Verify PHP installation ---
echo "[*] Verifying PHP installation..."
if command -v php &>/dev/null; then
  php --version
  echo "[*] PHP installed at: $(which php)"
else
  echo "[!] Error: PHP command not found after installation."
  exit 1
fi

# --- Test installing another PHP version (8.2) ---
echo "[*] Installing PHP 8.2 for version switching test..."
brew install shivammathur/php/php@8.2

# --- Test switching between PHP versions ---
echo ""
echo "[*] Testing PHP version switching..."
echo ""

echo "[*] Switching to PHP 8.2..."
brew unlink shivammathur/php/php@8.3
brew link --overwrite --force shivammathur/php/php@8.2
php --version | head -n 1

echo ""
echo "[*] Switching back to PHP 8.3..."
brew unlink shivammathur/php/php@8.2
brew link --overwrite --force shivammathur/php/php@8.3
php --version | head -n 1

# --- Show all installed PHP versions ---
echo ""
echo "[*] All installed PHP versions:"
brew list | grep "^php@" || echo "  (none found with pattern php@*)"
brew list | grep "shivammathur/php/php@" || echo "  (none found with shivammathur prefix)"

# --- Create a simple helper function for switching ---
echo ""
echo "[*] Creating switch-php helper function..."
cat > /tmp/switch-php-test.sh << 'SWITCH_EOF'
#!/usr/bin/env bash
switch-php() {
  local version="$1"
  if [[ -z "$version" ]]; then
    echo "Usage: switch-php <version>"
    echo "Example: switch-php 8.3"
    return 1
  fi

  # Unlink all PHP versions
  for php_ver in $(brew list | grep -E '^(shivammathur/php/)?php@'); do
    brew unlink "$php_ver" 2>/dev/null || true
  done

  # Link the requested version
  brew link --overwrite --force "shivammathur/php/php@${version}"
  php --version | head -n 1
}

switch-php "$@"
SWITCH_EOF

chmod +x /tmp/switch-php-test.sh

echo "[*] Testing switch-php helper function..."
/tmp/switch-php-test.sh 8.2
/tmp/switch-php-test.sh 8.3

echo ""
echo "====================================="
echo "[*] ✅ Test completed successfully!"
echo "====================================="
echo ""
echo "Summary:"
echo "  - Homebrew installed and working"
echo "  - shivammathur/php tap added"
echo "  - PHP 8.3 and 8.2 installed"
echo "  - Version switching tested and working"
echo ""
echo "To switch PHP versions manually:"
echo "  brew unlink shivammathur/php/php@8.3"
echo "  brew link --overwrite --force shivammathur/php/php@8.2"
echo ""
echo "Or use the helper function in your shell:"
echo "  switch-php() {"
echo "    for v in \$(brew list | grep -E '^(shivammathur/php/)?php@'); do"
echo "      brew unlink \"\$v\" 2>/dev/null || true"
echo "    done"
echo "    brew link --overwrite --force \"shivammathur/php/php@\${1}\""
echo "  }"
echo ""
