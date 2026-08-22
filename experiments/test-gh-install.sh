#!/usr/bin/env bash
set -euo pipefail

echo "[*] Testing GitHub CLI installation..."

# Create test directory
mkdir -p /tmp/test-gh-install
cd /tmp/test-gh-install

# Test the GitHub CLI installation method
echo "[*] Installing GitHub CLI using the fixed method..."
sudo mkdir -p -m 755 /etc/apt/keyrings
out=$(mktemp)
wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg
cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
rm -f $out

sudo mkdir -p -m 755 /etc/apt/sources.list.d
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null

echo "[*] Updating apt sources..."
sudo apt update -y

echo "[*] Installing gh..."
sudo apt install -y gh

echo "[*] Testing gh installation..."
gh --version

echo "[*] GitHub CLI installation test completed successfully!"