# Hive Mind Coolify Docker image
# Inherits from konard/sandbox which provides all general-purpose development tools
# This image adds AI-specific tools and application code for Coolify deployment
#
# Architecture (see issue #1394, #1499, #1505 and sandbox#73, sandbox#74):
#   konard/sandbox (pinned version)
#     └── All general dev tools: Node.js, Bun, Deno, Python, Go, Rust, Java, PHP, etc.
#     └── Playwright browsers pre-installed (chromium, firefox, webkit, msedge, chrome)
#     └── /workspace directory owned by sandbox user
#   hive-mind (this Dockerfile)
#     └── Inherits sandbox, adds AI coding assistants, Playwright MCP, and app code
#     └── Runs entirely as sandbox user (no USER root needed for tool installs)
#
# Sandbox image version: pinned to a specific release for stable, reproducible builds.
# To upgrade: update the version tag below and in the root Dockerfile.
# Latest sandbox releases: https://hub.docker.com/r/konard/sandbox/tags
#
# Build: docker build -f coolify/Dockerfile -t konard/hive-mind .

FROM konard/sandbox:1.6.0

# --- Environment variables ---
# Set environment variables EARLY so they're available in subsequent RUN commands
# All paths use /workspace (shared directory owned by sandbox:sandbox)
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
# Note: ~/.local/bin is included for user-installed binaries (e.g., opam binary from sandbox rocq image)
ENV PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:/home/linuxbrew/.linuxbrew/bin:/workspace/.pyenv/bin:/workspace/.pyenv/shims:/workspace/.rbenv/bin:/workspace/.rbenv/shims:/workspace/.swift/usr/bin:/workspace/.elan/bin:/workspace/.opam/default/bin:/workspace/.local/bin:/workspace/.cargo/bin:/workspace/.deno/bin:/workspace/.bun/bin:/workspace/.go/bin:/workspace/.go/path/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Run entirely as sandbox user — no USER root needed (see issue #1505)
USER sandbox
WORKDIR /workspace

# Create stable symlink to Node.js bin directory
RUN NODE_VERSION_DIR=$(ls -d /workspace/.nvm/versions/node/v* 2>/dev/null | head -1) && \
    if [ -n "$NODE_VERSION_DIR" ] && [ -d "$NODE_VERSION_DIR/bin" ]; then \
      ln -sf "$NODE_VERSION_DIR/bin" /workspace/.node-bin; \
    fi

ENV PATH="/workspace/.node-bin:${PATH}"

# --- Install opam binary ---
# The sandbox full image copies ~/.opam (opam switch data) from the rocq stage
# but does NOT copy the opam binary from ~/.local/bin. Install it as sandbox user.
# See: https://github.com/link-foundation/sandbox/issues/74
RUN mkdir -p /workspace/.local/bin && \
    ARCH="$(uname -m)" && \
    case "$ARCH" in \
      x86_64)  OPAM_ARCH="x86_64" ;; \
      aarch64) OPAM_ARCH="arm64" ;; \
      *)       OPAM_ARCH="$ARCH" ;; \
    esac && \
    OPAM_TAG=$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/ocaml/opam/releases/latest | sed 's|.*/||') && \
    curl -fsSL "https://github.com/ocaml/opam/releases/download/${OPAM_TAG}/opam-${OPAM_TAG}-${OPAM_ARCH}-linux" -o /workspace/.local/bin/opam && \
    chmod +x /workspace/.local/bin/opam

# --- AI-specific packages installation ---
# Every install must fail the build on error — no silent fallbacks (see issue #1505)

# Install AI coding assistant CLIs
RUN bun install -g @anthropic-ai/claude-code && \
    bun install -g @openai/codex && \
    bun install -g @qwen-code/qwen-code && \
    bun install -g @google/gemini-cli && \
    bun install -g @github/copilot && \
    bun install -g opencode-ai

# Install hive-mind workflow utilities
# Note: start-command provides `$` CLI for isolation modes (--isolation screen/tmux/docker)
# The sandbox base image includes screen. For tmux/docker isolation, ensure they are
# available in the base image or install them separately.
RUN bun install -g @link-assistant/hive-mind && \
    bun install -g @link-assistant/claude-profiles && \
    bun install -g @link-assistant/agent && \
    bun install -g start-command && \
    bun install -g gh-setup-git-identity && \
    bun install -g gh-pull-all && \
    bun install -g gh-load-issue && \
    bun install -g gh-load-pull-request && \
    bun install -g gh-upload-log

# --- Playwright MCP Setup ---
# Sandbox 1.6.0 pre-installs Playwright browsers and @playwright/test (sandbox#74).
# We only add @playwright/mcp (AI-specific MCP server for Claude).
# --force handles the shared 'playwright' binary conflict between packages.
RUN npm install -g @playwright/mcp@latest --no-fund --force

# Configure Playwright MCP for Claude CLI — fail the build if registration fails (issue #1514)
RUN if command -v claude &>/dev/null; then \
      claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080; \
    fi

# --- Application Setup ---
# Minimal USER root: only for creating /app directory and copying files.
# All /workspace operations run as sandbox user to prevent permission issues (issue #1505).
USER root
WORKDIR /app

# Copy application files from repo root
COPY --chown=sandbox:sandbox . .

# Ensure scripts are executable
RUN chmod +x *.mjs 2>/dev/null || true && \
    chmod +x src/*.mjs 2>/dev/null || true

# Create /app subdirectories (root-owned parent)
RUN mkdir -p /app/claude-logs /app/claude-sessions /app/output && \
    chown -R sandbox:sandbox /app

# Copy and configure startup script
COPY --chown=root:root coolify/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Switch to sandbox user for /workspace operations and runtime
USER sandbox

# Create necessary /workspace directories
RUN mkdir -p /workspace/.claude/plugins /workspace/.config

# Create bash profile for sandbox user
# Note: .node-bin is a symlink to the active Node.js version's bin directory
RUN echo 'export PATH="/workspace/.node-bin:/workspace/.bun/bin:/workspace/.cargo/bin:/workspace/.elan/bin:/workspace/.opam/default/bin:/home/linuxbrew/.linuxbrew/bin:$PATH"' >> /workspace/.bashrc && \
    echo 'export BUN_INSTALL="/workspace/.bun"' >> /workspace/.bashrc

# Create git config file for sandbox user
RUN echo "[user]" > /workspace/.gitconfig && \
    echo "  name = Hive-Mind Bot" >> /workspace/.gitconfig && \
    echo "  email = hive-mind@localhost" >> /workspace/.gitconfig && \
    echo "[init]" >> /workspace/.gitconfig && \
    echo "  defaultBranch = main" >> /workspace/.gitconfig && \
    echo "[safe]" >> /workspace/.gitconfig && \
    echo "  directory = *" >> /workspace/.gitconfig

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

SHELL ["/bin/bash", "-c"]
ENTRYPOINT ["/app/start.sh"]
