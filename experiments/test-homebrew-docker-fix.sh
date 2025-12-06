#!/usr/bin/env bash
# Experiment script to test Homebrew installation fix for Docker environments
# This simulates the Docker environment detection and directory pre-creation logic

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[*]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_note() { echo -e "${CYAN}[i]${NC} $1"; }

echo "========================================"
echo "Homebrew Docker Installation Test"
echo "========================================"
echo ""

# Test 1: Detect Docker environment
log_info "Test 1: Docker environment detection"
is_docker_env=false
if [ -f /.dockerenv ]; then
  is_docker_env=true
  log_success "Detected Docker via /.dockerenv file"
elif grep -qE 'docker|buildkit' /proc/1/cgroup 2>/dev/null; then
  is_docker_env=true
  log_success "Detected Docker via /proc/1/cgroup"
else
  log_warning "Not running in Docker environment"
fi
echo "is_docker_env=$is_docker_env"
echo ""

# Test 2: Check if Homebrew is already installed
log_info "Test 2: Check existing Homebrew installation"
if command -v brew &>/dev/null; then
  BREW_VERSION=$(brew --version 2>/dev/null | head -n1 || echo "version unknown")
  log_success "Homebrew already installed: $BREW_VERSION"
  BREW_LOCATION=$(command -v brew)
  log_note "Location: $BREW_LOCATION"
else
  log_warning "Homebrew not found in PATH"
fi
echo ""

# Test 3: Check Homebrew directories
log_info "Test 3: Check Homebrew directory locations"
if [ -d /home/linuxbrew/.linuxbrew ]; then
  log_success "Found /home/linuxbrew/.linuxbrew"
  ls -ld /home/linuxbrew/.linuxbrew
  if [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then
    log_success "brew binary exists and is executable"
    BREW_VER=$(/home/linuxbrew/.linuxbrew/bin/brew --version 2>/dev/null | head -n1 || echo "error")
    log_note "Version: $BREW_VER"
  else
    log_warning "brew binary not found or not executable"
  fi
else
  log_warning "/home/linuxbrew/.linuxbrew does not exist"
fi
echo ""

if [ -d "$HOME/.linuxbrew" ]; then
  log_success "Found $HOME/.linuxbrew"
  ls -ld "$HOME/.linuxbrew"
  if [ -x "$HOME/.linuxbrew/bin/brew" ]; then
    log_success "brew binary exists and is executable"
  else
    log_warning "brew binary not found or not executable"
  fi
else
  log_warning "$HOME/.linuxbrew does not exist"
fi
echo ""

# Test 4: Simulate directory creation logic
log_info "Test 4: Simulate directory pre-creation (Docker fix)"
if [ "$is_docker_env" = true ]; then
  log_note "Docker environment detected - would pre-create directory"

  BREW_OWNER="hive"
  if [ "$EUID" -ne 0 ]; then
    BREW_OWNER="$USER"
  fi
  log_note "Would set owner to: $BREW_OWNER"

  if id "$BREW_OWNER" &>/dev/null; then
    log_success "User $BREW_OWNER exists"
  else
    log_warning "User $BREW_OWNER does not exist"
  fi
else
  log_note "Not in Docker - would skip pre-creation"
fi
echo ""

# Test 5: Check current user and permissions
log_info "Test 5: User and permission information"
echo "Current user: $(whoami)"
echo "User ID: $EUID"
echo "Groups: $(groups)"
if [ "$EUID" -eq 0 ]; then
  log_note "Running as root"
else
  log_note "Running as non-root user"
fi
echo ""

# Test 6: Check if hive user exists
log_info "Test 6: Check hive user"
if id "hive" &>/dev/null; then
  log_success "hive user exists"
  echo "hive user info:"
  id hive
else
  log_warning "hive user does not exist"
fi
echo ""

# Test 7: Check PATH
log_info "Test 7: Current PATH"
echo "$PATH" | tr ':' '\n'
echo ""

# Test 8: Environment summary
log_info "Test 8: Environment summary"
echo "Docker environment: $is_docker_env"
echo "Homebrew in PATH: $(command -v brew &>/dev/null && echo 'yes' || echo 'no')"
echo "/home/linuxbrew/.linuxbrew exists: $([ -d /home/linuxbrew/.linuxbrew ] && echo 'yes' || echo 'no')"
echo "/home/linuxbrew/.linuxbrew/bin/brew exists: $([ -x /home/linuxbrew/.linuxbrew/bin/brew ] && echo 'yes' || echo 'no')"
echo "$HOME/.linuxbrew exists: $([ -d "$HOME/.linuxbrew" ] && echo 'yes' || echo 'no')"
echo ""

log_success "Test complete!"
