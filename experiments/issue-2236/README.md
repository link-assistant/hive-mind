# experiments/issue-2236 — regenerating the evidence

The findings in `docs/case-studies/issue-2236/README.md` come from reading the
shipped CLI artefacts. These are the commands that produce the dumps they were
read from. The dumps themselves are gitignored: together they are roughly
110 MB of extracted strings from somebody else's binaries, and they take about
two minutes to rebuild.

```bash
cd experiments/issue-2236

# Claude Code — the bundle is plain JS
cat "$(dirname "$(readlink -f "$(which claude)")")"/../lib/node_modules/@anthropic-ai/claude-code/cli.js > claude-js.txt
grep -oE '(CLAUDE_CODE|DISABLE)_[A-Z0-9_]+' claude-js.txt | sort -u > claude-env-vars.txt
grep -oE 'tengu_[a-z0-9_]+' claude-js.txt | sort | uniq -c | sort -rn > tengu-events.txt
node ctx.mjs claude-js.txt querySource 120 400 > querysource-contexts.txt

# Codex — a Rust binary
strings "$(readlink -f "$(which codex)")" > codex-strings.txt
grep -oE '[a-z0-9_/-]+\.rs' codex-strings.txt | sort -u > codex-files.txt
codex features list > codex-features.txt

# Qwen Code — settings schema out of the bundle
node ctx.mjs "$(dirname "$(readlink -f "$(which qwen)")")"/../lib/node_modules/@qwen-code/qwen-code/bundle/qwen.js skipNextSpeakerCheck 200 20 > qwen-schema.txt

# OpenCode — a Bun-compiled binary
strings "$(readlink -f "$(which opencode)")" > opencode-strings.txt
```

`ctx.mjs` prints `<radius>` characters around each of the first `<max>`
occurrences of a needle:

```bash
node ctx.mjs <file> <needle> <radius> <max>
```

It exists because `grep -o` with a wide context pattern
(`grep -o '.\{0,70\}needle.\{0,70\}'`) exceeds ugrep's regex complexity limit on
files this size.

## The end-to-end checks

Two claims in the case study are behavioural rather than textual, and were
verified by running the tools:

```bash
# OpenCode: disabling the hidden agents is accepted, and compaction survives
mkdir -p /tmp/oc-test/opencode
XDG_CONFIG_HOME=/tmp/oc-test opencode agent list          # baseline: 7 agents
echo '{"$schema":"https://opencode.ai/config.json","agent":{"title":{"disable":true},"summary":{"disable":true}}}' \
  > /tmp/oc-test/opencode/opencode.json
XDG_CONFIG_HOME=/tmp/oc-test opencode agent list          # 5 agents, exit 0, compaction still present

# Codex: -c overrides really do reach the feature registry
codex -c features.goals=false -c features.personality=false features list \
  | grep -E '^(goals|personality|memories) '
```
