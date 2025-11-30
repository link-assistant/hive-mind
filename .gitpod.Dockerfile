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

# Install Opam and Rocq (Coq theorem prover)
RUN brew install opam
RUN opam init --disable-sandboxing --auto-setup -y
RUN opam repo add rocq-released https://rocq-prover.org/opam/released || true
RUN eval $(opam env) && opam install rocq-prover -y || opam install coq -y || true
ENV PATH="/home/gitpod/.opam/default/bin:${PATH}"