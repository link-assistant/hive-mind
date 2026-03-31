# Hive Mind Docker image
# Inherits from konard/sandbox which provides all general-purpose development tools
# This image adds AI-specific tools (Claude CLI, OpenAI Codex, Playwright MCP, etc.)
#
# Architecture (see issue #1394, #1499, #1505 and sandbox#73, sandbox#74):
#   konard/sandbox (pinned version)
#     └── All general dev tools: Node.js, Bun, Deno, Python, Go, Rust, Java, PHP, etc.
#     └── Playwright browsers pre-installed (chromium, firefox, webkit, msedge, chrome)
#     └── /workspace directory owned by sandbox user
#   hive-mind (konard/hive-mind)
#     └── Inherits sandbox, adds AI coding assistants and Playwright MCP
#     └── Runs entirely as sandbox user (no USER root needed)
#
# Sandbox image version: pinned to a specific release for stable, reproducible builds.
# To upgrade: update the version tag below and in coolify/Dockerfile.
# Latest sandbox releases: https://hub.docker.com/r/konard/sandbox/tags
#
# Build: docker build -t konard/hive-mind .

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

# Opam environment variables for Rocq/Coq theorem prover
ENV OPAM_SWITCH_PREFIX="/workspace/.opam/default"
ENV CAML_LD_LIBRARY_PATH="/workspace/.opam/default/lib/stublibs:/workspace/.opam/default/lib/ocaml/stublibs:/workspace/.opam/default/lib/ocaml"
ENV OCAML_TOPLEVEL_PATH="/workspace/.opam/default/lib/toplevel"

# Comprehensive PATH including all tools
# Note: Node.js path is added dynamically since NVM version may vary
# Note: ~/.local/bin is included for user-installed binaries (e.g., opam binary from sandbox rocq image)
ENV PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:/home/linuxbrew/.linuxbrew/bin:/workspace/.pyenv/bin:/workspace/.pyenv/shims:/workspace/.rbenv/bin:/workspace/.rbenv/shims:/workspace/.swift/usr/bin:/workspace/.elan/bin:/workspace/.opam/default/bin:/workspace/.local/bin:/workspace/.cargo/bin:/workspace/.deno/bin:/workspace/.bun/bin:/workspace/.go/bin:/workspace/.go/path/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Run entirely as sandbox user — no USER root needed (see issue #1505)
USER sandbox
WORKDIR /workspace

# Create a stable symlink to the active Node.js version's bin directory
# This allows us to add it to PATH without knowing the specific version
RUN NODE_VERSION_DIR=$(ls -d /workspace/.nvm/versions/node/v* 2>/dev/null | head -1) && \
    if [ -n "$NODE_VERSION_DIR" ] && [ -d "$NODE_VERSION_DIR/bin" ]; then \
      ln -sf "$NODE_VERSION_DIR/bin" /workspace/.node-bin; \
    fi

ENV PATH="/workspace/.node-bin:${PATH}"

# --- AI-specific packages installation ---
# These are the tools that differentiate hive-mind from the generic sandbox
# Global bun packages for AI coding assistants and workflow utilities
# Every install must fail the build on error — no silent fallbacks (see issue #1505)

# Install AI coding assistant CLIs
RUN bun install -g @anthropic-ai/claude-code && \
    bun install -g @openai/codex && \
    bun install -g @qwen-code/qwen-code && \
    bun install -g @google/gemini-cli && \
    bun install -g @github/copilot && \
    bun install -g opencode-ai

# Install hive-mind workflow utilities
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

# Configure Playwright MCP for Claude CLI if available
RUN if command -v claude &>/dev/null; then \
      claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080 2>/dev/null || true; \
    fi

SHELL ["/bin/bash", "-c"]
CMD ["/bin/bash"]
