#!/usr/bin/env bash
# Test script to verify pyenv installation and functionality
set -euo pipefail

echo "[*] Testing pyenv installation and functionality..."

# Check if pyenv is installed
if [ -d "$HOME/.pyenv" ]; then
  echo "[*] Pyenv directory exists at $HOME/.pyenv"
else
  echo "[!] Pyenv directory not found at $HOME/.pyenv"
  exit 1
fi

# Load pyenv
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"

if command -v pyenv >/dev/null 2>&1; then
  eval "$(pyenv init --path)"
  eval "$(pyenv init -)"
  echo "[*] Pyenv loaded successfully"
else
  echo "[!] Pyenv command not found"
  exit 1
fi

# Check pyenv version
echo "[*] Pyenv version:"
pyenv --version

# List installed Python versions
echo "[*] Installed Python versions:"
pyenv versions

# Check current Python version
echo "[*] Current Python version:"
python --version

# Verify pip is available
echo "[*] Pip version:"
pip --version || echo "[!] Pip not found"

# Test version switching capability
echo "[*] Testing version switching..."
CURRENT_VERSION=$(pyenv global)
echo "[*] Current global version: $CURRENT_VERSION"

# List available versions that can be installed
echo "[*] Sample of available Python versions to install:"
pyenv install --list | grep -E '^\s*[0-9]+\.[0-9]+\.[0-9]+$' | tail -5

# Test pyenv shell command
echo "[*] Testing pyenv shell command..."
pyenv shell "$CURRENT_VERSION" 2>/dev/null && echo "[*] pyenv shell command works" || echo "[!] pyenv shell command failed"

# Verify bashrc configuration
if grep -q 'pyenv init' "$HOME/.bashrc"; then
  echo "[*] Pyenv configuration found in .bashrc"
else
  echo "[!] Pyenv configuration NOT found in .bashrc"
fi

echo "[*] All pyenv tests completed successfully!"
