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

# Install Node.js (if not already available)
RUN brew install node

# Create app directory
WORKDIR /app

# Copy application files
COPY . .

# Make scripts executable
RUN chmod +x solve.mjs
RUN chmod +x docker-restore-auth.sh

# Create directories for credentials
RUN mkdir -p /workspace/.persisted-configs/gh
RUN mkdir -p ~/.config

# Expose any needed ports (if solve.mjs uses any)
# EXPOSE 3000

# Default command
CMD ["./solve.mjs"]