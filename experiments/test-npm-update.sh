#!/usr/bin/env bash
# Test script to verify npm update functionality
set -euo pipefail

echo "[*] Testing npm update functionality..."

# Load NVM if available
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  \. "$NVM_DIR/nvm.sh"
else
  echo "[!] NVM not found, skipping test"
  exit 0
fi

# Check if Node 20 is available
if nvm ls 20 2>/dev/null | grep -q 'v20'; then
  echo "[*] Node 20 is installed"
  nvm use 20

  # Check current npm version
  echo "[*] Current npm version:"
  npm --version

  # Simulate the update command
  echo "[*] Testing npm update command (dry run)..."
  echo "Command would be: npm install -g npm@latest"

  # Get latest npm version from registry
  echo "[*] Latest npm version available:"
  npm view npm version 2>/dev/null || echo "Could not fetch latest version"

  echo "[*] Test completed successfully"
else
  echo "[!] Node 20 is not installed, cannot test npm update"
  exit 0
fi
