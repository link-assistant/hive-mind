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

# Quiet, deterministic Claude Code defaults for autonomous solve runs (issue #1642)
ENV CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
    CLAUDE_CODE_DISABLE_CRON=1 \
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 \
    CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 \
    CLAUDE_CODE_DISABLE_FAST_MODE=1 \
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1 \
    CLAUDE_CODE_DISABLE_MOUSE=1 \
    CLAUDE_CODE_ENABLE_AWAY_SUMMARY=0 \
    CLAUDE_CODE_ENABLE_TASKS=1 \
    CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=4 \
    CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1 \
    DISABLE_FEEDBACK_COMMAND=1

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
# These are the tools that differentiate hive-mind from the generic sandbox
# Global bun packages for AI coding assistants and workflow utilities
# Every install must fail the build on error — no silent fallbacks (see issue #1505)

# Install Claude Code through Anthropic's native installer. Bun blocks the
# @anthropic-ai/claude-code postinstall that links the native binary (issue #1633).
RUN curl -fsSL https://claude.ai/install.sh -o /tmp/claude-code-install.sh && \
    bash /tmp/claude-code-install.sh && \
    rm /tmp/claude-code-install.sh && \
    claude --version

# Install AI coding assistant CLIs
RUN bun install -g @openai/codex && \
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
# We only add @playwright/mcp (AI-specific MCP server for Claude/Codex).
# --force handles the shared 'playwright' binary conflict between packages.
RUN npm install -g @playwright/mcp@latest --no-fund --force

# Configure Playwright MCP for Claude CLI — fail the build if registration fails (issue #1514)
RUN if command -v claude &>/dev/null; then \
      claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080; \
    fi

# Configure Playwright MCP for Codex CLI with the same server settings
RUN if command -v codex &>/dev/null; then \
      codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080; \
    fi

# --- Disable noisy/unused Claude Code features and tools (issue #1627, issue #1642) ---
# Autonomous headless hive-mind runs never benefit from tools that wait for
# human interaction (AskUserQuestion, EnterPlanMode) or that register local
# session cron jobs (CronCreate/List/Delete) or create worktrees
# (EnterWorktree/ExitWorktree) or fire mobile notifications
# (PushNotification) or kick off remote agent triggers (RemoteTrigger)
# or create notebook cells (NotebookEdit) or monitor processes (Monitor) or
# self-schedule wakeups (ScheduleWakeup). Pre-seed the user-scope
# ~/.claude/settings.json disallowedTools list so that even interactive
# claude sessions in this image do not surface them.
# The three claude.ai OAuth connectors (Gmail/Google Drive/Google Calendar)
# cannot be removed via `claude mcp remove` because they are not registered
# under user/local/project scope; solve.mjs filters them at run time using
# --strict-mcp-config --mcp-config <temp-file>.
#
# The configuration is applied by the same `configure-claude` bin that users
# and system administrators can invoke manually after installing
# `@link-assistant/hive-mind` (see src/configure-claude.mjs). During image
# build we COPY a minimal subset of files so the bake step works before the
# package is globally installed — once the npm install above lands the
# published CLI, the `configure-claude` bin becomes available on PATH and
# this runs the same code path. All required env/settings/attribution/
# permissions maps and the idempotent merge helpers live in
# src/claude-quiet-config.lib.mjs and src/useless-tools.lib.mjs so the
# Dockerfile, solve command, and tests stay in lock-step.
COPY --chown=sandbox:sandbox \
    src/claude-quiet-config.lib.mjs \
    src/useless-tools.lib.mjs \
    src/configure-claude.lib.mjs \
    /workspace/.hive-mind-bake/src/
COPY --chown=sandbox:sandbox \
    scripts/configure-claude-quiet-defaults.mjs \
    /workspace/.hive-mind-bake/scripts/
RUN mkdir -p /workspace/.claude && \
    node /workspace/.hive-mind-bake/scripts/configure-claude-quiet-defaults.mjs \
        --settings-path /workspace/.claude/settings.json && \
    rm -rf /workspace/.hive-mind-bake

SHELL ["/bin/bash", "-c"]
CMD ["/bin/bash"]
