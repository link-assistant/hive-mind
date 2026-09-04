# Hive Mind Coolify Docker image
# Inherits from konard/box which provides all general-purpose development tools
# This image adds AI-specific tools and application code for Coolify deployment
#
# Architecture (see issue #1394, #1499, #1505 and box#79):
#   konard/box (pinned full image)
#     └── All general dev tools: Node.js, Bun, Deno, Python, Go, Rust, Java, PHP, etc.
#     └── Playwright browsers pre-installed (chromium, firefox, webkit, msedge, chrome)
#     └── /home/box directory owned by box user
#   hive-mind (this Dockerfile)
#     └── Inherits Box, adds AI coding assistants, Playwright MCP, and app code
#     └── Runs tool installs as box user (no USER root needed for those steps)
#
# Box image version: pinned to a specific release for stable, reproducible builds.
# To upgrade: update the version tag below and in the root Dockerfile.
# Keep this in lockstep with the DinD base-image release.
# Latest Box releases: https://github.com/link-foundation/box/releases
#
# Build: docker build -f coolify/Dockerfile -t konard/hive-mind .

ARG FORMAL_AI_VERSION=0.345.0
# Bookworm's glibc 2.36 remains compatible with the Ubuntu 24.04 Box runtime.
FROM rust:1.98-slim-bookworm AS formal-ai-builder
ARG FORMAL_AI_VERSION
# Formal AI 0.333.0-0.338.0 reached OpenSSL (formal-ai -> web-search ->
# web-capture -> reqwest with default features -> native-tls -> openssl-sys), so
# the builder needs pkg-config and the OpenSSL headers; rust:slim ships neither
# and the openssl-sys build script aborts the install. Reported upstream as
# link-assistant/formal-ai#988 and fixed in 0.339.0 (its Cargo.lock no longer
# contains openssl-sys), but the root causes are still open upstream
# (link-assistant/web-capture#151, link-foundation/browser-commander#77), so the
# packages stay as defense in depth: if a future release drags openssl-sys back
# in, OPENSSL_STATIC links libssl into the binary and the copy into the Ubuntu
# 24.04 runtime below stays independent of the runtime's OpenSSL soname; when
# openssl-sys is absent both are inert (see docs/case-studies/issue-2146).
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*
ENV OPENSSL_STATIC=1
RUN cargo install formal-ai --version "${FORMAL_AI_VERSION}" --locked

FROM konard/box:2.4.0
ARG HIVE_MIND_VERSION=latest
# Release builds pass the exact published package version here. Bake it as the
# default child isolation image tag so a parent started via :latest still runs
# Docker-isolated tasks on the same immutable release image.
ENV HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG="${HIVE_MIND_VERSION}"

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

# Quiet, deterministic Claude Code defaults for autonomous solve runs (issue #1642)
# The two memory switches are policy, not cosmetics: a hive-mind task keeps no
# memory a reviewer cannot see, so the repository stays the only memory (issue #2178)
ENV CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
    CLAUDE_CODE_DISABLE_ORG_MEMORY=1 \
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

ENV OPAM_SWITCH_PREFIX="/home/box/.opam/default"
ENV CAML_LD_LIBRARY_PATH="/home/box/.opam/default/lib/stublibs:/home/box/.opam/default/lib/ocaml/stublibs:/home/box/.opam/default/lib/ocaml"
ENV OCAML_TOPLEVEL_PATH="/home/box/.opam/default/lib/toplevel"

# Comprehensive PATH including all tools
# Note: ~/.local/bin is included for user-installed binaries (Claude Code and opam)
ENV PATH="/home/linuxbrew/.linuxbrew/opt/php@8.3/bin:/home/linuxbrew/.linuxbrew/opt/php@8.3/sbin:/home/linuxbrew/.linuxbrew/bin:/home/box/.pyenv/bin:/home/box/.pyenv/shims:/home/box/.rbenv/bin:/home/box/.rbenv/shims:/home/box/.swift/usr/bin:/home/box/.elan/bin:/home/box/.opam/default/bin:/home/box/.local/bin:/home/box/.cargo/bin:/home/box/.deno/bin:/home/box/.bun/bin:/home/box/.go/bin:/home/box/.go/path/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Run tool installation steps as box user — no USER root needed (see issue #1505)
USER box
WORKDIR /home/box

# Use bash for every subsequent RUN. nvm is sourced below and the build steps
# further down already use bash-only syntax (`&>`), which /bin/sh (dash) parses
# as "run in background, then redirect" — silently turning those guards into
# no-ops. Declaring the shell here instead of at the end of the file makes the
# steps run as they read (issue #2187).
SHELL ["/bin/bash", "-c"]

# --- Current Node.js and Bun (issue #2187) ---
# The Box base installs Node.js 20 (`nvm install 20` in box's
# ubuntu/24.04/js/install.sh) plus whatever Bun was current when the base was
# built, so every derived image inherits runtimes that are well behind the
# workloads. Hive Mind itself declares `engines.node >= 24`, and tasks on
# repositories that need something newer used to download their own node/bun
# into /tmp on every run and leave the copy behind — a second accumulation of
# versions on top of the image's own. Reported upstream as
# link-foundation/box#112 so the base stops shipping a stale Node.js.
#
# Pin the runtimes here (bump these ARGs like any other pin):
#   - HIVE_MIND_NODE_VERSION must stay >= the `engines.node` floor in package.json;
#     tests/test-issue-2187-runtime-versions.mjs fails the build otherwise.
#   - HIVE_MIND_BUN_VERSION is installed OVER the inherited binary, so ~/.bun keeps one
#     bun rather than accumulating versions.
#
# The nvm root is left with exactly ONE node version: the base's global npm
# packages are re-installed under the new version AT THEIR EXISTING VERSIONS
# (pinning matters — ~/.cache/ms-playwright already holds the browser builds
# matching the inherited playwright, so an unpinned upgrade would leave the CLI
# pointing at browsers the image does not have), then every other version
# directory is removed. `.node-bin`, `nvm use default` and a bare `node` then
# all resolve to the same, newest runtime (issue #2187, item A).
ARG HIVE_MIND_NODE_VERSION=24.20.0
ARG HIVE_MIND_BUN_VERSION=1.4.1
RUN set -e && \
    . "$NVM_DIR/nvm.sh" && \
    PREVIOUS_GLOBAL_LIB="$(dirname "$(dirname "$(command -v node)")")/lib/node_modules" && \
    GLOBAL_SPECS="" && \
    for package_json in "$PREVIOUS_GLOBAL_LIB"/*/package.json "$PREVIOUS_GLOBAL_LIB"/@*/*/package.json; do \
      [ -f "$package_json" ] || continue; \
      spec="$(node -p 'const pkg = require(process.argv[1]); pkg.name + "@" + pkg.version' "$package_json")"; \
      case "$spec" in npm@*|corepack@*) continue ;; esac; \
      GLOBAL_SPECS="$GLOBAL_SPECS $spec"; \
    done && \
    echo "Inherited global npm packages to re-install:${GLOBAL_SPECS:- (none)}" && \
    nvm install "${HIVE_MIND_NODE_VERSION}" && \
    nvm alias default "${HIVE_MIND_NODE_VERSION}" && \
    nvm use default && \
    if [ -n "$GLOBAL_SPECS" ]; then npm install -g $GLOBAL_SPECS --no-fund --force; fi && \
    for version_dir in "$NVM_DIR"/versions/node/*; do \
      [ -d "$version_dir" ] || continue; \
      if [ "$(basename "$version_dir")" = "v${HIVE_MIND_NODE_VERSION}" ]; then continue; fi; \
      echo "Removing superseded node $(basename "$version_dir")"; \
      rm -rf "$version_dir"; \
    done && \
    curl -fsSL https://bun.sh/install | bash -s "bun-v${HIVE_MIND_BUN_VERSION}" && \
    node --version && \
    npm --version && \
    "$BUN_INSTALL/bin/bun" --version

# Create stable symlink to Node.js bin directory
# `sort -V | tail -1` (not `ls | head -1`): `ls` sorts lexicographically and
# ascending, so once a second Node.js version is installed the plain listing
# picks the OLDEST one (and text-sorts "v9" above "v22"). Version-sort and take
# the last entry so /home/box/.node-bin always points at the newest node in the
# image (issue #2187).
RUN NODE_VERSION_DIR=$(ls -d /home/box/.nvm/versions/node/v* 2>/dev/null | sort -V | tail -1) && \
    if [ -n "$NODE_VERSION_DIR" ] && [ -d "$NODE_VERSION_DIR/bin" ]; then \
      ln -sf "$NODE_VERSION_DIR/bin" /home/box/.node-bin; \
    fi

ENV PATH="/home/box/.node-bin:${PATH}"

# Install the same pinned wrapper as the root and DinD images.
COPY --from=formal-ai-builder /usr/local/cargo/bin/formal-ai /usr/local/bin/formal-ai
RUN formal-ai --version

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
# Release builds pass HIVE_MIND_VERSION after npm publish, so Docker installs
# the exact package version that contains the configure-claude bin.
# Note: start-command provides `$` CLI for isolation modes (--isolation screen/tmux/docker)
# The Box base image includes screen. For tmux/docker isolation, ensure they are
# available in the base image or install them separately.
RUN echo "Installing @link-assistant/hive-mind@${HIVE_MIND_VERSION}" && \
    bun install -g "@link-assistant/hive-mind@${HIVE_MIND_VERSION}" && \
    if [ "${HIVE_MIND_VERSION}" != "latest" ]; then \
      test "$(hive --version)" = "${HIVE_MIND_VERSION}"; \
    fi && \
    bun install -g @link-assistant/claude-profiles && \
    bun install -g @link-assistant/agent && \
    bun install -g start-command && \
    bun install -g gh-setup-git-identity && \
    bun install -g gh-pull-all && \
    bun install -g gh-load-issue && \
    bun install -g gh-load-pull-request && \
    bun install -g gh-upload-log@latest

# --- Playwright MCP Setup ---
# Box 2.1.1 pre-installs Playwright browsers and @playwright/test.
# We only add @playwright/mcp (AI-specific MCP server for Claude/Codex).
# --force handles the shared 'playwright' binary conflict between packages.
RUN npm install -g @playwright/mcp@latest --no-fund --force

# Verify both the Playwright CLI fallback and the locally installed MCP package.
RUN playwright --version && \
    npx --no-install @playwright/mcp --help | grep -q -- '--headless'

# Configure Playwright MCP for Claude CLI — fail the build if registration fails (issue #1514)
RUN if command -v claude &>/dev/null; then \
      claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080; \
    fi

# Configure Playwright MCP for Codex CLI with the same server settings
RUN if command -v codex &>/dev/null; then \
      codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080; \
    fi

# Fail the image build if MCP registration is merely present but unavailable.
RUN if command -v claude >/dev/null 2>&1; then \
      CLAUDE_MCP_OUTPUT="$(claude mcp list 2>&1)" && \
      echo "$CLAUDE_MCP_OUTPUT" && \
      echo "$CLAUDE_MCP_OUTPUT" | grep -Eiq 'playwright.*(connected|enabled)' && \
      ! echo "$CLAUDE_MCP_OUTPUT" | grep -Eiq 'playwright.*(pending|disabled|failed|error|disconnected|not[-_[:space:]]+connected|unavailable|timed[-_[:space:]]+out|(^|[^[:alnum:]_-])timeout($|[^[:alnum:]_-]))'; \
    fi && \
    if command -v codex >/dev/null 2>&1; then \
      CODEX_MCP_OUTPUT="$(codex mcp list 2>&1)" && \
      echo "$CODEX_MCP_OUTPUT" && \
      echo "$CODEX_MCP_OUTPUT" | grep -Eiq 'playwright.*(connected|enabled)' && \
      ! echo "$CODEX_MCP_OUTPUT" | grep -Eiq 'playwright.*(pending|disabled|failed|error|disconnected|not[-_[:space:]]+connected|unavailable|timed[-_[:space:]]+out|(^|[^[:alnum:]_-])timeout($|[^[:alnum:]_-]))'; \
    fi

# --- Disable noisy/unused Claude Code features and tools (issue #1627, issue #1642) ---
# Autonomous headless hive-mind runs never benefit from tools that wait for
# human interaction or leave persistent side effects. Pre-seed the
# user-scope ~/.claude/settings.json disallowedTools list so that even
# interactive claude sessions in this image do not surface them. The three
# claude.ai OAuth connectors (Gmail/Google Drive/Google Calendar) cannot be
# removed via `claude mcp remove` because they are not registered under
# user/local/project scope; solve.mjs filters them at run time using
# --strict-mcp-config --mcp-config <temp-file>.
#
# Behavior matrix (see root Dockerfile for full rationale):
#   - Release builds (HIVE_MIND_VERSION=<exact>): `configure-claude` MUST
#     exist and succeed.
#   - PR builds (HIVE_MIND_VERSION=latest): tolerate a not-yet-published bin;
#     solve re-applies the baseline at runtime.
RUN mkdir -p /home/box/.claude && \
    if [ "${HIVE_MIND_VERSION}" != "latest" ]; then \
      configure-claude --settings-path /home/box/.claude/settings.json && \
      configure-claude --settings-path /home/box/.claude/settings.json --verify; \
    elif command -v configure-claude >/dev/null 2>&1; then \
      configure-claude --settings-path /home/box/.claude/settings.json && \
      configure-claude --settings-path /home/box/.claude/settings.json --verify; \
    else \
      echo "configure-claude not present in @link-assistant/hive-mind@latest yet (likely a PR build before the bin is published); skipping baseline — solve re-applies it at runtime"; \
    fi

# --- Application Setup ---
# Minimal USER root: only for creating /app directory and copying files.
# All /home/box operations run as box user to prevent permission issues (issue #1505).
USER root
WORKDIR /app

# Copy application files from repo root
COPY --chown=box:box . .

# Ensure scripts are executable
RUN chmod +x *.mjs 2>/dev/null || true && \
    chmod +x src/*.mjs 2>/dev/null || true

# Create /app subdirectories (root-owned parent)
RUN mkdir -p /app/claude-logs /app/claude-sessions /app/output && \
    chown -R box:box /app

# Copy and configure startup script
COPY --chown=root:root coolify/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Switch to box user for /home/box setup
USER box

# Create necessary /home/box directories
RUN mkdir -p /home/box/.claude/plugins /home/box/.config

# Create bash profile for box user
# Note: .node-bin is a symlink to the active Node.js version's bin directory
RUN echo 'export PATH="/home/box/.node-bin:/home/box/.bun/bin:/home/box/.cargo/bin:/home/box/.elan/bin:/home/box/.opam/default/bin:/home/linuxbrew/.linuxbrew/bin:$PATH"' >> /home/box/.bashrc && \
    echo 'export BUN_INSTALL="/home/box/.bun"' >> /home/box/.bashrc

# Create git config file for box user
RUN echo "[user]" > /home/box/.gitconfig && \
    echo "  name = Hive-Mind Bot" >> /home/box/.gitconfig && \
    echo "  email = hive-mind@localhost" >> /home/box/.gitconfig && \
    echo "[init]" >> /home/box/.gitconfig && \
    echo "  defaultBranch = main" >> /home/box/.gitconfig && \
    echo "[safe]" >> /home/box/.gitconfig && \
    echo "  directory = *" >> /home/box/.gitconfig

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

# Start as root only to repair bind-mounted directory ownership, then start.sh
# drops to the box user before running hive-mind.
USER root

ENTRYPOINT ["/app/start.sh"]
