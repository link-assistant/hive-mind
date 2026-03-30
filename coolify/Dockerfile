# Hive Mind Coolify Docker image
# Inherits from konard/sandbox which provides all general-purpose development tools
# This image adds AI-specific tools and application code for Coolify deployment
#
# Architecture (see issue #1394, #1499 and sandbox#73):
#   konard/sandbox (pinned version)
#     └── All general dev tools: Node.js, Bun, Deno, Python, Go, Rust, Java, PHP, etc.
#     └── /workspace directory owned by sandbox user
#   hive-mind (this Dockerfile)
#     └── Inherits sandbox, adds AI coding assistants and app code
#     └── Uses default sandbox user (no custom user creation needed)
#
# Sandbox image version: pinned to a specific release for stable, reproducible builds.
# To upgrade: update the version tag below and in the root Dockerfile.
# Latest sandbox releases: https://hub.docker.com/r/konard/sandbox/tags
#
# Build: docker build -f coolify/Dockerfile -t konard/hive-mind .

FROM konard/sandbox:1.5.0

USER root

# Install opam package manager system-wide (needed for OCaml/Rocq package management)
# The sandbox image installs the opam binary to ~/.local/bin (user-local) but does not copy it
# to the final image. Installing via apt makes opam accessible system-wide.
RUN apt-get update -y && apt-get install -y opam && apt-get clean && rm -rf /var/lib/apt/lists/*

# --- Environment variables ---
# Set environment variables EARLY so they're available in subsequent RUN commands
# All paths use /workspace (shared directory from sandbox 1.5.0)
ENV HOME=/workspace
ENV NVM_DIR="/workspace/.nvm"
ENV PYENV_ROOT="/workspace/.pyenv"
ENV BUN_INSTALL="/workspace/.bun"
ENV DENO_INSTALL="/workspace/.deno"
ENV CARGO_HOME="/workspace/.cargo"
ENV GOROOT="/workspace/.go"
ENV GOPATH="/workspace/.go/path"
ENV SDKMAN_DIR="/workspace/.sdkman"
ENV PERLBREW_ROOT="/workspace/.perl5"
ENV RBENV_ROOT="/workspace/.rbenv"

ENV OPAM_SWITCH_PREFIX="/workspace/.opam/default"
ENV CAML_LD_LIBRARY_PATH="/workspace/.opam/default/lib/stublibs:/workspace/.opam/default/lib/ocaml/stublibs:/workspace/.opam/default/lib/ocaml"
ENV OCAML_TOPLEVEL_PATH="/workspace/.opam/default/lib/toplevel"

# Comprehensive PATH including all tools
# Note: ~/.local/bin is included for user-installed binaries (e.g., opam binary installed by rocq install script)
ENV PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:/home/linuxbrew/.linuxbrew/bin:/workspace/.pyenv/bin:/workspace/.pyenv/shims:/workspace/.rbenv/bin:/workspace/.rbenv/shims:/workspace/.swift/usr/bin:/workspace/.elan/bin:/workspace/.opam/default/bin:/workspace/.local/bin:/workspace/.cargo/bin:/workspace/.deno/bin:/workspace/.bun/bin:/workspace/.go/bin:/workspace/.go/path/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Create stable symlink to Node.js bin directory
RUN NODE_VERSION_DIR=$(ls -d /workspace/.nvm/versions/node/v* 2>/dev/null | head -1) && \
    if [ -n "$NODE_VERSION_DIR" ] && [ -d "$NODE_VERSION_DIR/bin" ]; then \
      ln -sf "$NODE_VERSION_DIR/bin" /workspace/.node-bin; \
    fi

ENV PATH="/workspace/.node-bin:${PATH}"

# Switch to sandbox user for package installations
USER sandbox
WORKDIR /workspace

# --- AI-specific packages installation ---
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
# Sandbox 1.5.0 provides playwright CLI and system dependencies.
# We add @playwright/mcp (MCP server for Claude) and @playwright/test (test runner).
# --force handles the shared 'playwright' binary conflict between packages.
# See: https://github.com/link-foundation/sandbox/issues/74 (request to preinstall in sandbox)
RUN npm install -g @playwright/mcp@latest @playwright/test@latest --no-fund --force

# Install browsers — architecture-aware: Chrome/Edge only on x86_64, Chromium for arm64
# Sandbox already has all OS-level dependencies installed.
# Google Chrome requires sudo because it installs to system paths.
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then \
      playwright install chromium firefox webkit msedge chromium-headless-shell && \
      sudo env "PATH=$PATH" HOME=/workspace playwright install chrome; \
    else \
      playwright install chromium firefox webkit chromium-headless-shell; \
    fi

# Configure Playwright MCP for Claude CLI if available
RUN if command -v claude &>/dev/null; then \
      claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080 2>/dev/null || true; \
    fi

# --- Application Setup ---
WORKDIR /app

USER root

# Copy application files from repo root
COPY --chown=sandbox:sandbox . .

# Ensure scripts are executable
RUN chmod +x *.mjs 2>/dev/null || true && \
    chmod +x src/*.mjs 2>/dev/null || true

# Create necessary directories
RUN mkdir -p /app/claude-logs /app/claude-sessions /app/output && \
    mkdir -p /workspace/.claude/plugins /workspace/.config && \
    chown -R sandbox:sandbox /app /workspace/.claude /workspace/.config

# Create bash profile for sandbox user
# Note: .node-bin is a symlink to the active Node.js version's bin directory
RUN echo 'export PATH="/workspace/.node-bin:/workspace/.bun/bin:/workspace/.cargo/bin:/workspace/.elan/bin:/workspace/.opam/default/bin:/home/linuxbrew/.linuxbrew/bin:$PATH"' >> /workspace/.bashrc && \
    echo 'export BUN_INSTALL="/workspace/.bun"' >> /workspace/.bashrc && \
    chown sandbox:sandbox /workspace/.bashrc

# Create git config file for sandbox user
RUN echo "[user]" > /workspace/.gitconfig && \
    echo "  name = Hive-Mind Bot" >> /workspace/.gitconfig && \
    echo "  email = hive-mind@localhost" >> /workspace/.gitconfig && \
    echo "[init]" >> /workspace/.gitconfig && \
    echo "  defaultBranch = main" >> /workspace/.gitconfig && \
    echo "[safe]" >> /workspace/.gitconfig && \
    echo "  directory = *" >> /workspace/.gitconfig && \
    chown sandbox:sandbox /workspace/.gitconfig

# Switch back to sandbox user for runtime
USER sandbox

# Runtime configuration
ENV NODE_ENV=production
ENV PORT=3000
ENV MONITOR_TAG="help wanted"
ENV CONCURRENCY=2
ENV INTERVAL=300
ENV MODEL=sonnet

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep -f "hive.mjs\|tail" > /dev/null || exit 1

# Copy and configure startup script
USER root
COPY --chown=root:root coolify/start.sh /app/start.sh
RUN chmod +x /app/start.sh

SHELL ["/bin/bash", "-c"]
ENTRYPOINT ["/app/start.sh"]
