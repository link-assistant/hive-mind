# Hive Mind Docker image
# Inherits from konard/box which provides all general-purpose development tools
# This image adds AI-specific tools (Claude CLI, OpenAI Codex, Playwright MCP, etc.)
#
# Architecture (see issue #1394, #1499, #1505 and box#79):
#   konard/box (pinned full image)
#     └── All general dev tools: Node.js, Bun, Deno, Python, Go, Rust, Java, PHP, etc.
#     └── Playwright browsers pre-installed (chromium, firefox, webkit, msedge, chrome)
#     └── /home/box directory owned by box user
#   hive-mind (konard/hive-mind)
#     └── Inherits Box, adds AI coding assistants and Playwright MCP
#     └── Runs entirely as box user (no USER root needed)
#
# Box image version: pinned to a specific release for stable, reproducible builds.
# To upgrade: update the version tag below and in coolify/Dockerfile.
# Latest Box releases: https://github.com/link-foundation/box/releases
#
# Build: docker build -t konard/hive-mind .

FROM konard/box:2.0.1

# --- Environment variables ---
# Set environment variables EARLY so they're available in subsequent RUN commands
# All paths use /home/box (shared directory owned by box:box)
ENV HOME=/home/box
ENV NVM_DIR="/home/box/.nvm"
ENV PYENV_ROOT="/home/box/.pyenv"
ENV BUN_INSTALL="/home/box/.bun"
ENV DENO_INSTALL="/home/box/.deno"
ENV CARGO_HOME="/home/box/.cargo"
ENV GOROOT="/home/box/.go"
ENV GOPATH="/home/box/.go/path"
ENV SDKMAN_DIR="/home/box/.sdkman"
ENV PERLBREW_ROOT="/home/box/.perl5"
ENV RBENV_ROOT="/home/box/.rbenv"

# Opam environment variables for Rocq/Coq theorem prover
ENV OPAM_SWITCH_PREFIX="/home/box/.opam/default"
ENV CAML_LD_LIBRARY_PATH="/home/box/.opam/default/lib/stublibs:/home/box/.opam/default/lib/ocaml/stublibs:/home/box/.opam/default/lib/ocaml"
ENV OCAML_TOPLEVEL_PATH="/home/box/.opam/default/lib/toplevel"

# Comprehensive PATH including all tools
# Note: Node.js path is added dynamically since NVM version may vary
# Note: ~/.local/bin is included for user-installed binaries (Claude Code and opam)
ENV PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:/home/linuxbrew/.linuxbrew/bin:/home/box/.pyenv/bin:/home/box/.pyenv/shims:/home/box/.rbenv/bin:/home/box/.rbenv/shims:/home/box/.swift/usr/bin:/home/box/.elan/bin:/home/box/.opam/default/bin:/home/box/.local/bin:/home/box/.cargo/bin:/home/box/.deno/bin:/home/box/.bun/bin:/home/box/.go/bin:/home/box/.go/path/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Run entirely as box user — no USER root needed (see issue #1505)
USER box
WORKDIR /home/box

# Create a stable symlink to the active Node.js version's bin directory
# This allows us to add it to PATH without knowing the specific version
RUN NODE_VERSION_DIR=$(ls -d /home/box/.nvm/versions/node/v* 2>/dev/null | head -1) && \
    if [ -n "$NODE_VERSION_DIR" ] && [ -d "$NODE_VERSION_DIR/bin" ]; then \
      ln -sf "$NODE_VERSION_DIR/bin" /home/box/.node-bin; \
    fi

ENV PATH="/home/box/.node-bin:${PATH}"

# --- Install opam binary ---
# The Box full image includes the Rocq/Coq opam switch data. Keep an explicit
# opam binary in ~/.local/bin so verification and interactive use are stable.
RUN mkdir -p /home/box/.local/bin && \
    ARCH="$(uname -m)" && \
    case "$ARCH" in \
      x86_64)  OPAM_ARCH="x86_64" ;; \
      aarch64) OPAM_ARCH="arm64" ;; \
      *)       OPAM_ARCH="$ARCH" ;; \
    esac && \
    OPAM_TAG=$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/ocaml/opam/releases/latest | sed 's|.*/||') && \
    curl -fsSL "https://github.com/ocaml/opam/releases/download/${OPAM_TAG}/opam-${OPAM_TAG}-${OPAM_ARCH}-linux" -o /home/box/.local/bin/opam && \
    chmod +x /home/box/.local/bin/opam

# --- AI-specific packages installation ---
# These are the tools that differentiate hive-mind from the generic Box image
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
# The Box base image includes screen. For tmux/docker isolation, ensure they are
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
# Box 2.0.1 pre-installs Playwright browsers and @playwright/test.
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

# --- Disable useless Claude Code built-in tools (issue #1627) ---
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
RUN mkdir -p /home/box/.claude && \
    node -e " \
const fs = require('fs'); \
const p = '/home/box/.claude/settings.json'; \
const blocked = ['AskUserQuestion','CronCreate','CronDelete','CronList','EnterPlanMode','EnterWorktree','ExitPlanMode','ExitWorktree','Monitor','NotebookEdit','PushNotification','RemoteTrigger','ScheduleWakeup','mcp__claude_ai_Gmail__*','mcp__claude_ai_Google_Drive__*','mcp__claude_ai_Google_Calendar__*']; \
let s = {}; \
try { s = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) {} \
if (!s || typeof s !== 'object' || Array.isArray(s)) s = {}; \
const existing = Array.isArray(s.disallowedTools) ? s.disallowedTools : []; \
const merged = [...existing]; \
for (const t of blocked) if (!merged.includes(t)) merged.push(t); \
s.disallowedTools = merged; \
fs.writeFileSync(p, JSON.stringify(s, null, 2)); \
console.log('Configured', merged.length, 'disallowedTools in', p); \
"

SHELL ["/bin/bash", "-c"]
CMD ["/bin/bash"]
