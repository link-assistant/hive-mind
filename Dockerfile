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
# Keep this in lockstep with the DinD base-image release.
# Latest Box releases: https://github.com/link-foundation/box/releases
#
# Build: docker build -t konard/hive-mind .

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

# Create a stable symlink to the active Node.js version's bin directory
# This allows us to add it to PATH without knowing the specific version
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

# Build with Formal AI's declared MSRV and copy only its release binary.
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
# Release builds pass HIVE_MIND_VERSION after npm publish, so Docker installs
# the exact package version that contains the configure-claude bin.
# Note: start-command provides `$` CLI for isolation modes (--isolation screen/tmux/docker)
# The Box base image includes screen. For tmux/docker isolation, ensure they are
# available in the base image or install them separately.
# start-command is pinned to 0.33.0: 0.29.1 fixed detached docker
# `--status`/`--list` reporting a terminal status (`executed`) with the `-1`
# sentinel while the container is still running (link-foundation/start#136,
# link-assistant/hive-mind#1939); 0.29.2 (start#138 / start PR #139) records the
# docker image-preparation phase (the `docker pull`/dind boot) in the session log,
# so `$ --upload-log` no longer returns a near-empty log while a multi-GB image is
# still pulling. 0.30.1 (start#140 / start PR #141) adds explicit docker
# container cleanup policies and removes successful containers by default while
# keeping the host-side log, which Hive Mind also enforces at task completion
# for defense in depth (issue #1979). 0.30.2 (start#144) surfaces detached docker
# `OOMKilled` status and preserves abnormally-terminated container filesystems
# under the default cleanup policy — the upstream defense-in-depth half of the
# #1990 fix (the primary terminal-completion gate lives in this repo's solve).
# 0.30.3 (start#148/#149) reconciles detached Docker `OOMKilled=true` as terminal
# in upstream `--status`/`--list`, which directly covers issue #2015.
# 0.31.0 (start#154 / start PR #155) adds `--network` / `--network-alias` for the
# docker isolation backend. 0.32.0 (start#156 / start PR #157, unblocked for npm
# by start#160) makes `--network` repeatable: the first network is passed to
# `docker create` and the rest are attached with `docker network connect` before
# `docker start`, so a task could join the default bridge AND the `--internal`
# Formal AI sidecar network at launch. Hive Mind still performs that same
# additive `docker network connect` itself, inside the already-held start gate:
# the sequencing is identical, the gate is held anyway for the writable-layer
# baseline, and the in-repo attach keeps working (fail-closed) on any
# start-command version instead of silently degrading to a single network on
# pre-0.32.0 parsers (see docs/case-studies/issue-2146, issue #2146).
# 0.33.0 (start#162, #164, #165) closes the three upstream issues this repo filed
# from the issue #2189 incident: `--attach` / `--resume <uuid>` / `--resume-all`
# re-enter an existing execution — same container, same execution UUID — instead
# of forcing a fresh isolated run (start#162); `--status`/`--list` expose
# `exitReason` and `memoryExhausted`/`memoryExhaustedReason`, so a V8 heap
# self-abort (`FATAL ERROR: Reached heap limit`, exit 134/139 with `oomKilled`
# false and cgroup `oom_kill` 0) is no longer indistinguishable from a forced
# kill (start#164); and the exit markers are detected in a bounded 64 KiB log-tail
# window instead of buffering the whole log (start#165). Hive Mind consumes all
# three and keeps its own log-marker kill classification and streaming sanitizer
# as defense in depth, so behaviour degrades gracefully on an older `$` binary
# (see docs/case-studies/issue-2189, issue #2189).
# `@link-assistant/agent` is pinned to 0.26.1, the release that stopped the
# unbounded snapshot leak of issue #2186. Up to 0.26.0 `Snapshot.track()` built a
# standalone git object store per project — keyed on the worktree's root commit,
# with no `objects/info/alternates` and no garbage collection — so a harness that
# runs the agent in throwaway `git init` checkouts left one full ~270 MB copy of
# the repository behind per invocation: 115 orphaned stores / 31 GB in a single
# task, growing at ~5 GB/h, in `~/.local/share/link-assistant-agent/snapshot/`
# where none of Hive Mind's `/tmp`-scoped disk checks could see it.
# link-assistant/agent#298 (PR #300) shares the repository's objects and prunes
# projects whose recorded worktree is gone. `src/agent.lib.mjs` enforces the same
# floor at runtime, so the pin and the guard cannot drift apart.
RUN echo "Installing @link-assistant/hive-mind@${HIVE_MIND_VERSION}" && \
    bun install -g "@link-assistant/hive-mind@${HIVE_MIND_VERSION}" && \
    if [ "${HIVE_MIND_VERSION}" != "latest" ]; then \
      test "$(hive --version)" = "${HIVE_MIND_VERSION}"; \
    fi && \
    bun install -g @link-assistant/claude-profiles && \
    bun install -g @link-assistant/agent@0.26.1 && \
    bun install -g start-command@0.33.0 && \
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
# Behavior matrix:
#   - Release builds (HIVE_MIND_VERSION=<exact>): `configure-claude` MUST exist
#     in the published package and MUST succeed. Build fails otherwise.
#   - PR builds (HIVE_MIND_VERSION=latest): the currently published package on
#     npm may pre-date this PR and not yet ship `configure-claude`. In that
#     case we log and skip — the baseline is re-applied at runtime by solve.
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

CMD ["/bin/bash"]
