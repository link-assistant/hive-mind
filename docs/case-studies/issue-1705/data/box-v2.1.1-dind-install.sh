#!/usr/bin/env bash
set -euo pipefail

# Docker-in-Docker (dind-box) installation script
# Adds the Docker Engine, CLI, containerd, Buildx, and Compose plugins to any
# existing box image (js, essentials, full, or any language box).
#
# Usage: BASE_VARIANT=<name> bash ubuntu/24.04/dind/install.sh
#
# This script is idempotent and runs as root during image build.
# It also adds the box user to the docker group so the inner dockerd is usable
# without sudo from the user shell.
#
# References:
#   - https://docs.docker.com/engine/install/ubuntu/
#   - https://github.com/cruizba/ubuntu-dind
#   - docs/case-studies/issue-80/CASE-STUDY.md

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../common.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../common.sh"
else
  log_info() { echo "[*] $1"; }
  log_success() { echo "[✓] $1"; }
  log_warning() { echo "[!] $1"; }
  log_error() { echo "[✗] $1"; }
  log_step() { echo "==> $1"; }
  command_exists() { command -v "$1" &>/dev/null; }
  maybe_sudo() { if [ "$EUID" -eq 0 ]; then "$@"; elif command -v sudo &>/dev/null; then sudo "$@"; else "$@"; fi; }
fi

log_step "Installing Docker-in-Docker (dind-box) layer"

# --- Pre-flight ---
if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
  log_error "This script requires sudo access."
  exit 1
fi

ARCH="$(dpkg --print-architecture)"
log_info "Detected architecture: $ARCH"

# --- Install Docker Engine, CLI, containerd, Buildx, Compose ---
log_step "Adding Docker apt repository"

export DEBIAN_FRONTEND=noninteractive

maybe_sudo apt-get update -y
maybe_sudo apt-get install -y \
  ca-certificates curl gnupg lsb-release iptables uidmap

maybe_sudo install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | maybe_sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  maybe_sudo chmod a+r /etc/apt/keyrings/docker.gpg
fi

UBUNTU_CODENAME="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-${VERSION_CODENAME:-noble}}")"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" \
  | maybe_sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

log_step "Installing docker-ce, docker-ce-cli, containerd.io, buildx, compose"
maybe_sudo apt-get update -y
maybe_sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin \
  fuse-overlayfs

log_success "Docker packages installed"

# --- Ensure docker group exists and add box user ---
log_step "Configuring docker group for box user"
if ! getent group docker >/dev/null; then
  maybe_sudo groupadd docker
fi
if id box &>/dev/null; then
  maybe_sudo usermod -aG docker box
  log_success "Added box user to docker group"
else
  log_warning "box user not present yet; skipping group membership"
fi

# --- Install dind entrypoint ---
log_step "Installing dind entrypoint"
maybe_sudo install -m 0755 "$SCRIPT_DIR/dind-entrypoint.sh" /usr/local/bin/dind-entrypoint.sh
log_success "dind entrypoint installed at /usr/local/bin/dind-entrypoint.sh"

# --- Persist marker so users / tests can detect dind-box images ---
maybe_sudo mkdir -p /etc/box
echo "dind-box" | maybe_sudo tee /etc/box/variant >/dev/null

# --- Cleanup ---
log_step "Cleaning up apt caches"
maybe_sudo apt-get clean
maybe_sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

log_step "dind-box layer installation complete"
log_success "Run with: docker run --privileged konard/<base>-dind"
