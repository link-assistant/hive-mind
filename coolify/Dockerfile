FROM ubuntu:24.04

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Update and install base packages
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    git \
    sudo \
    ca-certificates \
    gnupg \
    lsb-release \
    build-essential \
    python3 \
    expect \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install .NET SDK 8.0
RUN wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh \
    && chmod +x dotnet-install.sh \
    && ./dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet \
    && rm dotnet-install.sh \
    && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet

# Install GitHub CLI
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create hive user
RUN useradd -m -s /bin/bash hive

# Switch to hive user for language tools installation
USER hive
WORKDIR /home/hive

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/home/hive/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# Install Node.js via n with proper prefix for user installation
ENV N_PREFIX=/home/hive/.n
ENV PATH="${N_PREFIX}/bin:${PATH}"
RUN curl -L https://raw.githubusercontent.com/tj/n/master/bin/n -o n \
    && bash n lts \
    && rm n

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/home/hive/.cargo/bin:${PATH}"

# Install global npm/bun packages
RUN bun install -g \
    @anthropic-ai/claude-code \
    @deep-assistant/claude-profiles \
    @deep-assistant/hive-mind

# Create app directory
WORKDIR /app

# Switch back to root to copy files and set permissions
USER root

# Copy application files from repo root (build context)
COPY --chown=hive:hive . .

# Ensure scripts are executable
RUN chmod +x *.mjs || true

# Create necessary directories
RUN mkdir -p /app/claude-logs /app/claude-sessions /app/output \
    && mkdir -p /home/hive/.claude/plugins /home/hive/.config \
    && chown -R hive:hive /app /home/hive/.claude /home/hive/.config

# Create bash profile for hive user to set PATH
RUN echo 'export PATH="/home/hive/.bun/bin:/home/hive/.n/bin:/home/hive/.cargo/bin:$PATH"' > /home/hive/.bashrc \
    && echo 'export BUN_INSTALL="/home/hive/.bun"' >> /home/hive/.bashrc \
    && echo 'export N_PREFIX="/home/hive/.n"' >> /home/hive/.bashrc \
    && chown hive:hive /home/hive/.bashrc

# Create git config file for hive user
RUN echo "[user]" > /home/hive/.gitconfig \
    && echo "  name = Hive-Mind Bot" >> /home/hive/.gitconfig \
    && echo "  email = hive@localhost" >> /home/hive/.gitconfig \
    && echo "[init]" >> /home/hive/.gitconfig \
    && echo "  defaultBranch = main" >> /home/hive/.gitconfig \
    && echo "[safe]" >> /home/hive/.gitconfig \
    && echo "  directory = *" >> /home/hive/.gitconfig \
    && chown hive:hive /home/hive/.gitconfig

# Switch back to hive user for runtime
USER hive

# Environment variables (can be overridden)
ENV NODE_ENV=production
ENV PORT=3000
ENV MONITOR_TAG="help wanted"
ENV CONCURRENCY=2
ENV INTERVAL=300
ENV MODEL=sonnet

# Health check - check if container is running (either hive.mjs or tail)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep -f "hive.mjs\|tail" > /dev/null || exit 1

# Create startup script with proper permissions handling
USER root
COPY --chown=root:root coolify/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Default command - run the startup script
ENTRYPOINT ["/app/start.sh"]