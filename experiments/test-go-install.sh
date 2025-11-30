#!/usr/bin/env bash
# Test script to verify Go installation and functionality
set -euo pipefail

echo "[*] Testing Go installation and functionality..."

# Check if Go is installed in user's home directory
if [ -d "$HOME/.go" ]; then
  echo "[*] Go directory exists at $HOME/.go"
elif [ -d "/usr/local/go" ]; then
  echo "[*] Go installed at /usr/local/go (system-wide)"
else
  echo "[!] Go directory not found"
  exit 1
fi

# Load Go for current session
if [ -d "$HOME/.go/bin" ]; then
  export GOROOT="$HOME/.go"
  export GOPATH="$HOME/go"
  export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"
elif [ -d "/usr/local/go/bin" ]; then
  export PATH="/usr/local/go/bin:$PATH"
  export GOPATH="$HOME/go"
fi

if command -v go &>/dev/null; then
  echo "[*] Go command found in PATH"
else
  echo "[!] Go command not found"
  exit 1
fi

# Check Go version
echo "[*] Go version:"
go version

# Check Go environment
echo "[*] Go environment:"
go env GOROOT GOPATH GOBIN

# Verify GOPATH directory exists
if [ -d "$GOPATH" ]; then
  echo "[*] GOPATH directory exists: $GOPATH"
else
  echo "[!] GOPATH directory not found: $GOPATH"
  echo "[*] Creating GOPATH directory..."
  mkdir -p "$GOPATH"
fi

# Test Go compilation with a simple program
echo "[*] Testing Go compilation..."
TEMP_DIR=$(mktemp -d)
cat > "$TEMP_DIR/hello.go" << 'GOCODE'
package main

import "fmt"

func main() {
    fmt.Println("Hello from Go!")
}
GOCODE

cd "$TEMP_DIR"
if go run hello.go; then
  echo "[*] Go compilation and execution successful"
else
  echo "[!] Go compilation failed"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Test go build
if go build -o hello hello.go; then
  echo "[*] Go build successful"
  ./hello
else
  echo "[!] Go build failed"
fi

# Cleanup
rm -rf "$TEMP_DIR"

# Verify bashrc configuration
if grep -q 'GOROOT.*\.go' "$HOME/.bashrc" 2>/dev/null; then
  echo "[*] Go configuration found in .bashrc"
elif grep -q '/usr/local/go' "$HOME/.bashrc" 2>/dev/null; then
  echo "[*] Go configuration found in .bashrc (system install)"
else
  echo "[!] Go configuration NOT found in .bashrc"
fi

echo "[*] All Go tests completed successfully!"
