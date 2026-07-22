#!/usr/bin/env bash
# Issue #2094 — prove, with a real Codex CLI and no ChatGPT authentication,
# that `features.remote_plugin` in `config.toml` is the exact knob the fix
# writes.
#
# `reproduce-curated-loader-boundary.sh` demonstrates the loader boundary
# itself, but it needs an authenticated home with a curated marketplace
# snapshot, so most reviewers cannot run it. The fix, however, rests on one
# additional claim that *is* checkable anywhere Codex is installed: that the
# scoped `config.toml` Hive writes reaches `PluginsConfigInput.remote_plugin_enabled`
# rather than being silently ignored. A silently ignored key would make the
# production fix a no-op while every simulated test still passed.
#
# Requirements: a Codex CLI on PATH (or CODEX_BIN). No account, no network.

set -euo pipefail

CODEX_BIN="${CODEX_BIN:-$(command -v codex)}"
PROBE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/issue-2094-config-key.XXXXXX")"
PROBE_HOME="$PROBE_ROOT/.codex"

cleanup() {
  rm -rf "$PROBE_ROOT"
}
trap cleanup EXIT

mkdir -p "$PROBE_HOME"
"$CODEX_BIN" --version

# 1. A deliberately mistyped value must be rejected. Codex can only report a
#    type error for a key it actually deserializes, so this is positive proof
#    that `[features] remote_plugin` is read from `config.toml`.
printf '[features]\nremote_plugin = "banana"\n' >"$PROBE_HOME/config.toml"
if CODEX_HOME="$PROBE_HOME" "$CODEX_BIN" debug prompt-input 'issue-2094 config key probe' >"$PROBE_ROOT/mistyped.txt" 2>&1; then
  printf 'FAIL: Codex accepted a non-boolean features.remote_plugin; the key is not parsed from config.toml\n' >&2
  exit 1
fi
grep -q 'expected a boolean' "$PROBE_ROOT/mistyped.txt"
grep -q 'in `features`' "$PROBE_ROOT/mistyped.txt"
printf 'ok: features.remote_plugin is deserialized from config.toml as a boolean\n'

# 2. The scoped file Hive actually writes must load cleanly, including the
#    plugin enablement block that lives beside the override.
printf '[features]\nremote_plugin = false\nmulti_agent = true\n\n[plugins."superpowers@openai-curated"]\nenabled = true\n' >"$PROBE_HOME/config.toml"
CODEX_HOME="$PROBE_HOME" "$CODEX_BIN" debug prompt-input 'issue-2094 scoped config probe' >"$PROBE_ROOT/scoped.txt" 2>&1
grep -q 'skills_instructions' "$PROBE_ROOT/scoped.txt"
printf 'ok: the scoped config shape written by the fix loads and still renders a prompt\n'

# 3. An unrecognized key under the same table is tolerated. This bounds the
#    blast radius if a later Codex release renames the feature: the override
#    degrades to a no-op instead of breaking every Codex invocation for the
#    repository, and the #2089 fail-closed probe still refuses to start a
#    solver whose skills are not visible.
printf '[features]\nhive_mind_unknown_feature = false\n' >"$PROBE_HOME/config.toml"
CODEX_HOME="$PROBE_HOME" "$CODEX_BIN" debug prompt-input 'issue-2094 forward compatibility probe' >"$PROBE_ROOT/unknown.txt" 2>&1
grep -q 'skills_instructions' "$PROBE_ROOT/unknown.txt"
printf 'ok: an unknown [features] key is ignored rather than fatal\n'

printf '\nThe fix writes a real, type-checked config.toml key that the Codex loader\n'
printf 'consumes, and it fails safe if that key ever disappears upstream.\n'
