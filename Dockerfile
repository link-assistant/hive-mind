FROM ubuntu:24.04

# Ubuntu 24.04 LTS base image for production deployment
# Set non-interactive frontend for apt
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /workspace

# Copy the installation script
COPY scripts/ubuntu-24-server-install.sh /tmp/ubuntu-24-server-install.sh

# Make the script executable and run it
# Pass DOCKER_BUILD=1 environment variable to indicate Docker build environment
# This is needed because standard Docker detection (/.dockerenv, cgroup checks)
# doesn't work reliably during Docker build with BuildKit
RUN chmod +x /tmp/ubuntu-24-server-install.sh && \
    DOCKER_BUILD=1 bash /tmp/ubuntu-24-server-install.sh && \
    rm -f /tmp/ubuntu-24-server-install.sh

# Switch to hive user
USER hive

# Set home directory
WORKDIR /home/hive

# Set up environment variables for all the tools installed by the script
ENV NVM_DIR="/home/hive/.nvm"
ENV PYENV_ROOT="/home/hive/.pyenv"
ENV BUN_INSTALL="/home/hive/.bun"
# Include PHP paths from Homebrew (PHP is keg-only and needs explicit PATH entry)
ENV PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:/home/hive/.bun/bin:/home/hive/.pyenv/bin:/home/hive/.nvm/versions/node/v20.*/bin:/home/linuxbrew/.linuxbrew/bin:${PATH}"

# Load NVM, Pyenv, and other tools in shell sessions
SHELL ["/bin/bash", "-c"]

# Set default command to bash
CMD ["/bin/bash"]
