FROM gitpod/workspace-full:latest

# Install gh and bun
RUN brew install gh
RUN brew install oven-sh/bun/bun

ENV BUN_INSTALL="/home/gitpod/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# Install Claude Code
RUN bun install -g @anthropic-ai/claude-code

# Install Claude Profiles
RUN bun install -g @link-assistant/claude-profiles

# Install OpenCode AI
RUN bun install -g opencode-ai