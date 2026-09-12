# Data manifest — issue #2236

Everything under `data/` was produced from the CLIs installed on the machine
where issue #2236 was solved. Each file records what those versions actually
shipped, which is the part of this case study most likely to be wrong a year
from now — the counts and listings are here so the next audit can re-run them
and diff.

| File                       | Produced by                                                                                       | Size        | Why it is kept                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-features-list.txt`  | `codex features list` (codex-cli 0.153.4)                                                         | 135 flags   | The live default state of every Codex feature flag. The basis for choosing `goals` and `personality`, and for the claim that `memories` et al. are already `false`. |
| `qwen-settings-schema.txt` | settings schema extracted from the qwen-code 0.23.0 bundle as `category \| key = default` triples | ~250 keys   | Proves which keys exist in that build — the evidence that `disableLLMCorrection` does **not**, and that the `memory.*` keys do.                                     |
| `codex-source-paths.txt`   | Rust source paths extracted from the codex-cli 0.153.4 binary                                     | 1,635 paths | The evidence that Codex's title/recap/branch-summary call sites are all under `tui/src/app/`, i.e. unreachable from `codex exec`.                                   |
| `claude-env-vars.txt`      | `CLAUDE_CODE_*` / `DISABLE_*` names extracted from the claude-code 2.1.269 bundle                 | ~28 KB      | The universe of local gates. Shows the five that were pinned, and that `DISABLE_MICROCOMPACT` and `DISABLE_NON_ESSENTIAL_MODEL_CALLS` are absent.                   |

## Not kept

The raw dumps these were distilled from are deliberately **not** committed —
they are 33 MB (claude), 10 MB (codex) and 64 MB (opencode) of extracted
strings, they are reproducible in a couple of minutes, and a repository is a
bad place to keep a copy of somebody else's binary.

`experiments/issue-2236/README.md` records the exact commands that regenerate
them, along with `ctx.mjs`, the small helper used to print context around each
match (ordinary `grep -o` with wide context patterns exceeds ugrep's complexity
limit on files this size).
