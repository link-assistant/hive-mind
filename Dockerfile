# Hive Mind Docker image
# Inherits from konard/sandbox which provides all general-purpose development tools
# This image adds AI-specific tools (Claude CLI, OpenAI Codex, Playwright MCP, etc.)
#
# Architecture (see issue #1394 and PR sandbox#65):
#   konard/sandbox (pinned version)
#     └── All general dev tools: Node.js, Bun, Deno, Python, Go, Rust, Java, PHP, etc.
#   hive-mind (konard/hive-mind)
#     └── Inherits sandbox, adds AI coding assistants and browser automation
#
# Sandbox image version: pinned to a specific release for stable, reproducible builds.
# To upgrade: update the version tag below and in coolify/Dockerfile.
# Latest sandbox releases: https://hub.docker.com/r/konard/sandbox/tags
#
# Build: docker build -t konard/hive-mind .

FROM konard/sandbox:1.3.16

USER root

# Rename sandbox user to hive for backward compatibility
# This maintains compatibility with existing deployments and configurations
# that expect the 'hive' user (e.g., Coolify deployments, volume mounts)
RUN usermod -l hive sandbox && \
    usermod -d /home/hive -m hive && \
    groupmod -n hive sandbox && \
    # Update sudoers if present
    if [ -f /etc/sudoers.d/sandbox ]; then \
      sed -i 's/sandbox/hive/g' /etc/sudoers.d/sandbox && \
      mv /etc/sudoers.d/sandbox /etc/sudoers.d/hive; \
    fi && \
    # Fix ownership of home directory contents
    chown -R hive:hive /home/hive

# Install opam package manager system-wide (needed for OCaml/Rocq package management)
# The sandbox image installs the opam binary to ~/.local/bin (user-local) but does not copy it
# to the final image. Installing via apt makes opam accessible system-wide.
RUN apt-get update -y && apt-get install -y opam && apt-get clean && rm -rf /var/lib/apt/lists/*

# Fix any references to old user in config files
RUN find /home/hive -name "*.bashrc" -o -name "*.profile" -o -name "*.bash_profile" 2>/dev/null | \
    xargs -I{} sed -i 's|/home/sandbox|/home/hive|g' {} 2>/dev/null || true

# Fix NVM installation paths (sandbox -> hive)
# NVM stores the installation path in nvm.sh and default-packages
RUN if [ -f /home/hive/.nvm/nvm.sh ]; then \
      sed -i 's|/home/sandbox|/home/hive|g' /home/hive/.nvm/nvm.sh; \
    fi && \
    if [ -f /home/hive/.nvm/bash_completion ]; then \
      sed -i 's|/home/sandbox|/home/hive|g' /home/hive/.nvm/bash_completion; \
    fi && \
    # Update NVM_DIR in all shell configs
    find /home/hive -maxdepth 1 -name ".*rc" -o -name ".*profile" 2>/dev/null | \
      xargs -I{} sed -i 's|NVM_DIR="/home/sandbox|NVM_DIR="/home/hive|g' {} 2>/dev/null || true

# --- Environment variables ---
# Set environment variables EARLY so they're available in subsequent RUN commands
# All paths adjusted from /home/sandbox to /home/hive
ENV HOME=/home/hive
ENV NVM_DIR="/home/hive/.nvm"
ENV PYENV_ROOT="/home/hive/.pyenv"
ENV BUN_INSTALL="/home/hive/.bun"
ENV DENO_INSTALL="/home/hive/.deno"
ENV CARGO_HOME="/home/hive/.cargo"
ENV GOROOT="/home/hive/.go"
ENV GOPATH="/home/hive/.go/path"
ENV SDKMAN_DIR="/home/hive/.sdkman"
ENV PERLBREW_ROOT="/home/hive/.perl5"
ENV RBENV_ROOT="/home/hive/.rbenv"

# Opam environment variables for Rocq/Coq theorem prover
ENV OPAM_SWITCH_PREFIX="/home/hive/.opam/default"
ENV CAML_LD_LIBRARY_PATH="/home/hive/.opam/default/lib/stublibs:/home/hive/.opam/default/lib/ocaml/stublibs:/home/hive/.opam/default/lib/ocaml"
ENV OCAML_TOPLEVEL_PATH="/home/hive/.opam/default/lib/toplevel"

# Comprehensive PATH including all tools
# Note: Node.js path is added dynamically since NVM version may vary
# Note: ~/.local/bin is included for user-installed binaries (e.g., opam binary installed by rocq install script)
ENV PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:/home/linuxbrew/.linuxbrew/bin:/home/hive/.pyenv/bin:/home/hive/.pyenv/shims:/home/hive/.rbenv/bin:/home/hive/.rbenv/shims:/home/hive/.swift/usr/bin:/home/hive/.elan/bin:/home/hive/.opam/default/bin:/home/hive/.local/bin:/home/hive/.cargo/bin:/home/hive/.deno/bin:/home/hive/.bun/bin:/home/hive/.go/bin:/home/hive/.go/path/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Create a stable symlink to the active Node.js version's bin directory
# This allows us to add it to PATH without knowing the specific version
RUN NODE_VERSION_DIR=$(ls -d /home/hive/.nvm/versions/node/v* 2>/dev/null | head -1) && \
    if [ -n "$NODE_VERSION_DIR" ] && [ -d "$NODE_VERSION_DIR/bin" ]; then \
      ln -sf "$NODE_VERSION_DIR/bin" /home/hive/.node-bin && \
      chown -h hive:hive /home/hive/.node-bin; \
    fi

ENV PATH="/home/hive/.node-bin:${PATH}"

# Switch to hive user for package installations
USER hive
WORKDIR /home/hive

# --- AI-specific packages installation ---
# These are the tools that differentiate hive-mind from the generic sandbox
# Global bun packages for AI coding assistants and workflow utilities

# Install AI coding assistant CLIs
RUN bun install -g @anthropic-ai/claude-code || echo "claude-code: not yet published" && \
    bun install -g @openai/codex || echo "codex: not yet published" && \
    bun install -g @qwen-code/qwen-code || echo "qwen-code: not yet published" && \
    bun install -g @google/gemini-cli || echo "gemini-cli: not yet published" && \
    bun install -g @github/copilot || echo "copilot: not yet published" && \
    bun install -g opencode-ai || echo "opencode-ai: not yet published"

# Install hive-mind workflow utilities
RUN bun install -g @link-assistant/hive-mind || echo "hive-mind: not yet published" && \
    bun install -g @link-assistant/claude-profiles || echo "claude-profiles: not yet published" && \
    bun install -g @link-assistant/agent || echo "agent: not yet published" && \
    bun install -g start-command || echo "start-command: not yet published" && \
    bun install -g gh-setup-git-identity || echo "gh-setup-git-identity: not yet published" && \
    bun install -g gh-pull-all || echo "gh-pull-all: not yet published" && \
    bun install -g gh-load-issue || echo "gh-load-issue: not yet published" && \
    bun install -g gh-load-pull-request || echo "gh-load-pull-request: not yet published" && \
    bun install -g gh-upload-log || echo "gh-upload-log: not yet published"

# --- Playwright Browser Automation Setup ---
# Install Playwright MCP server for browser automation via Claude CLI
# Note: npm is available via the .node-bin symlink in PATH
RUN npm install -g @playwright/mcp@latest --no-fund --silent

# Install Playwright CLI and all browsers
# Architecture-aware: Chrome/Edge only on x86_64, Chromium for arm64
RUN npm install -g @playwright/test@latest --no-fund --silent && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then \
      playwright install chromium chrome firefox webkit msedge chromium-headless-shell; \
    else \
      playwright install chromium firefox webkit chromium-headless-shell; \
    fi

# Install Playwright OS dependencies (requires root)
USER root
RUN npx playwright@latest install-deps 2>/dev/null || true

USER hive

# Configure Playwright MCP for Claude CLI if available
RUN if command -v claude &>/dev/null; then \
      claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080 2>/dev/null || true; \
    fi

SHELL ["/bin/bash", "-c"]
CMD ["/bin/bash"]
