FROM gitpod/workspace-full:latest

# Install gh and bun
RUN brew install gh
RUN brew install oven-sh/bun/bun

ENV BUN_INSTALL="/home/gitpod/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# Install Claude Code
RUN bun install -g @anthropic-ai/claude-code

# Install Claude Profiles
RUN bun install -g @deep-assistant/claude-profiles

# Install OpenCode AI
RUN bun install -g opencode-ai

# Install Lean (via elan)
RUN curl https://elan.lean-lang.org/elan-init.sh -sSf | sh -s -- -y --default-toolchain stable
ENV PATH="/home/gitpod/.elan/bin:${PATH}"