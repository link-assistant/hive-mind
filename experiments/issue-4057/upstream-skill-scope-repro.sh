#!/usr/bin/env bash
# Issue #4057, upstream report: Codex has a scope-wide switch only for bundled
# skills (`[skills.bundled] enabled = false`). An isolated CODEX_HOME still
# exposes user (`$HOME/.agents/skills`) and admin (`/etc/codex/skills`) skills,
# so a sandboxed run cannot restrict the catalog to the repository's own skills
# without first listing every host skill and disabling it by path.
#
# Usage: experiments/issue-4057/upstream-skill-scope-repro.sh [codex-binary]
# Offline: the provider points at 127.0.0.1:1 and the API key is synthetic.
set -euo pipefail
CODEX="${1:-codex}"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export HOME="$ROOT/home" CODEX_HOME="$ROOT/codex-home" RUST_LOG=off GIT_CONFIG_GLOBAL=/dev/null
mkdir -p "$HOME/.agents/skills/host-skill" "$CODEX_HOME" "$ROOT/repo/.agents/skills/repo-skill"
printf -- '---\nname: host-skill\ndescription: installed on the host\n---\nbody\n' > "$HOME/.agents/skills/host-skill/SKILL.md"
printf -- '---\nname: repo-skill\ndescription: shipped by the repository\n---\nbody\n' > "$ROOT/repo/.agents/skills/repo-skill/SKILL.md"
git init -q "$ROOT/repo"
printf '{"OPENAI_API_KEY":"sk-SYNTHETIC"}' > "$CODEX_HOME/auth.json"
base='model="gpt-5"\nmodel_provider="offline"\n[model_providers.offline]\nname="Offline"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[skills.bundled]\nenabled=false\n'
skills() { (cd "$ROOT/repo" && "$CODEX" debug prompt-input 2>/dev/null) | grep -oE '(host|repo)-skill: [^(]*\(file: [^)]*' | sed "s|$ROOT|<tmp>|g" | sort -u || true; }

printf "$base" > "$CODEX_HOME/config.toml"
echo "== 1. bundled skills off, nothing else: the host skill is visible"; skills
printf "$base[[skills.config]]\npath=\"%s\"\nenabled=false\n" "$HOME/.agents/skills/host-skill/SKILL.md" > "$CODEX_HOME/config.toml"
echo "== 2. workaround: disable each host skill by path (requires listing them first)"; skills
printf "$base" > "$CODEX_HOME/config.toml"
mkdir -p "$ROOT/empty-home"
echo "== 3. workaround: HOME pointed at an empty directory (also changes git/gh/ssh lookups)"; HOME="$ROOT/empty-home" skills
"$CODEX" --version
