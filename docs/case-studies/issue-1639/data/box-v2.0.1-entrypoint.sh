#!/usr/bin/env bash
# Entrypoint script for box container
# Sources all environment managers and runs the given command

# Source bashrc to load all environment managers
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi

# Additional explicit loading of tools that may not be covered by bashrc

# NVM
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  source "$NVM_DIR/nvm.sh"
fi

# Pyenv
export PYENV_ROOT="$HOME/.pyenv"
if [ -d "$PYENV_ROOT/bin" ]; then
  export PATH="$PYENV_ROOT/bin:$PATH"
  if command -v pyenv >/dev/null 2>&1; then
    eval "$(pyenv init --path)" 2>/dev/null || true
    eval "$(pyenv init -)" 2>/dev/null || true
  fi
fi

# Go
if [ -d "$HOME/.go" ]; then
  export GOROOT="$HOME/.go"
  export GOPATH="$HOME/.go/path"
  export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"
fi

# SDKMAN (Java)
export SDKMAN_DIR="$HOME/.sdkman"
if [ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]; then
  set +u
  source "$SDKMAN_DIR/bin/sdkman-init.sh" 2>/dev/null || true
  set -u
fi

# Opam (OCaml/Rocq)
if command -v opam >/dev/null 2>&1; then
  eval "$(opam env --switch=default 2>/dev/null)" || true
fi

# Perlbrew
export PERLBREW_ROOT="$HOME/.perl5"
if [ -f "$PERLBREW_ROOT/etc/bashrc" ]; then
  set +u
  source "$PERLBREW_ROOT/etc/bashrc" 2>/dev/null || true
  set -u
fi

# Execute the command passed to the container
exec "$@"
