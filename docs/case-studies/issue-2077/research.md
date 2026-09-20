# Online and component research — issue 2077

Sources were retrieved during this investigation; URLs are listed at the end.
Where something is undocumented, this file says so rather than guessing.

## 1. Can `16:9` ever be a legal Codex capability name?

**No — and this is the fact the fix is built on.**

Skill names, per the Agent Skills specification (agentskills.io):

> May only contain unicode lowercase alphanumeric characters (`a-z`, `0-9`) and
> hyphens (`-`) … must be 1–64 characters … must not start or end with a hyphen
> … must not contain consecutive hyphens … must match the parent directory name.

Plugin and marketplace names, per `codex-rs/plugin/src/plugin_id.rs`:

```rust
if !segment.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
    return Err(format!("invalid {kind}: only ASCII letters, digits, `_`, and `-` are allowed"));
}
```

A colon is outside both charsets. `16:9` cannot name a skill, a plugin or a
marketplace under any configuration.

### A correction this research forced on the fix

The first draft of the fix required capability names to **start with a letter**.
That is _stricter than the specification_: a leading digit is legal, so
`3d-rendering` is a valid skill name and would have been wrongly rejected.

The rule was changed to **"must contain at least one letter"**, which is
spec-compliant and still rejects every false positive in the incident, because
each one is purely numeric on at least one side of its separator (`16:9` → `9`,
`localhost:3000` → `3000`, `node@20` → `20`, `$100` → `100`). The charset also
now admits the underscore that `validate_plugin_segment` accepts.

Two documented rules are deliberately _not_ enforced, because they would add
false negatives with no false-positive benefit: the 64-character limit and the
no-consecutive-hyphens rule.

## 2. Is per-task (non-global) plugin scoping possible? — requirement R1

Yes, and Hive Mind already implements the only mechanism that currently works.

- **`CODEX_HOME` is documented** and "defaults to `~/.codex`". It holds
  `config.toml`, `auth.json`, `history.jsonl`, `hooks.json`, `log/` and named
  profile layers.
- **Plugin state is `CODEX_HOME`-relative.** `codex-rs/core-plugins/src/startup_sync.rs`
  pins the curated marketplace snapshot to `.tmp/plugins` with `.tmp/plugins.sha`
  and `.tmp/plugins.sync.lock`, all resolved against `codex_home`. Enablement is
  recorded as `[plugins."name@marketplace"] enabled = true` in
  `$CODEX_HOME/config.toml`. A distinct `CODEX_HOME` therefore fully isolates
  plugin enablement — which is exactly what `buildCodexCapabilityStatePath` and
  `prepareScopedCodexHome` do, including the `.tmp/plugins` symlink that avoids
  re-syncing the marketplace per repository.
- **The obvious alternative is a trap.** Project-level `./.codex/config.toml`
  exists, but `[plugins.*]` entries in it are **silently ignored** as of CLI
  0.138.0 (openai/codex#18115): plugin state flows through
  `configured_plugins_from_stack` → `effective_user_config`, which project layers
  never enter. Hive Mind must not migrate to it.
- **No per-invocation `--plugin` flag is documented.** Upstream #18115 explicitly
  names separate `CODEX_HOME`s as the current workaround.

**Conclusion for R1:** no new mechanism is required, and the existing design is
the correct one. Related open upstream requests — #18115 (repo-scoped plugin
config), #30023 (local-only plugin install), #21425 (separate installed plugins
from per-session skill metadata) — already cover the ergonomic gap, so a fourth
report from this incident would be duplicate noise.

## 3. Prior art for extracting requirements from free-form text

Directly relevant to root cause 1, since the durable fix is to stop guessing.

- **No off-the-shelf library does this reliably.** Software-entity NER on
  developer text tops out around **78–79 F1** (SoftNER/BERTOverflow, ACL 2020;
  noise-robust SER, ASE 2023), and the literature consistently reports _library
  names_ as the hardest class. One scientific-software holdout evaluation
  measured **precision ≈0.56 with recall ≈0.93** — precisely the wrong skew for
  a gate that aborts runs.
- **Production tooling deliberately refuses to parse prose.** Dependabot and
  GitHub's dependency graph read manifests only. Renovate's custom managers make
  users declare an explicit regex with named capture groups rather than inferring
  from text.
- **Code-span-only extraction is dramatically more precise** than prose
  extraction: ~**P 0.92 / R 0.90** for code elements versus 0.56–0.79 in prose.
  Hive Mind's existing backtick-anchored pattern is on the right side of this;
  the _unanchored_ `namespace:name` scan is on the wrong side.
- **Canonical token formats exist.** purl (`pkg:type/name@version`) is now
  ECMA-427 and adopted by SPDX 3.0.1 and CycloneDX; its `pkg:` prefix makes false
  positives near-zero. GitHub Issue Forms render answers under stable headings,
  turning extraction into heading parsing — the highest-precision option
  available.
- **Registry validation as an acceptance gate** (deps.dev v3 has exact-match
  lookup but no free-text search) is a good confirmation signal, useless as an
  extractor.

### Recommended direction (not implemented here)

The precision ceiling on prose scanning is real. A future change should let an
issue _declare_ capabilities explicitly — a fenced block, an Issue Form field, or
a `Required-Codex-Capabilities:` trailer — and treat the prose scan as a
low-confidence suggestion only. That is a larger design change than this
incident warrants; Fix 2 (degrade instead of abort) makes the current heuristic
safe in the meantime.

## 4. Codebase audit for the same defect class — requirement R12

A repository-wide audit looked for (a) regexes inferring structured meaning from
issue/PR/comment prose, (b) identifier regexes permitting purely numeric tokens,
and (c) fatal `throw`s driven by a heuristic guess.

**No second instance of the full defect exists.** `detectRequiredCodexCapabilities`
has exactly one call site (inside its own module), and it is the only place in
the repository where a name inferred from human prose gates execution through a
`throw`. Both defects are fixed at their single site.

The audit did surface four places on the same _spectrum_ — prose-derived
inferences whose consequences are non-fatal. They are recorded here rather than
changed, because each is a distinct defect with a distinct correct fix, and
bundling them into an incident fix would obscure this PR's argument:

| Site                                     | Inference                                                              | Consequence of a false positive                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/process-debug.lib.mjs:93`           | `\b(claude\|codex\|gemini\|…)\b` over log text that embeds issue prose | Diagnostic mislabels the tool; first-match-wins makes `claude` always beat `codex` |
| `src/process-debug.lib.mjs:73`           | generic `working directory:\s*(…)` fallback pattern                    | Wrong cleanup path, mitigated by the `/tmp/gh-issue-solver-*` preference           |
| `src/external-review-limit.lib.mjs:8`    | `/coderabbit/i` + `/rate\s*limit/i` over CodeRabbit's own review prose | A genuinely failing check is reclassified "not actionable" (fails open)            |
| `src/contributing-guidelines.lib.mjs:77` | guesses a docs URL out of README link text                             | A dead link in supplementary context                                               |

None throws, and none aborts a run. Judged safe on inspection:
`github-linking.lib.mjs` (deliberately mirrors GitHub's own closing-keyword
semantics, so its "false positives" are what GitHub itself does),
`solve.keep-working.detect.lib.mjs` (documented recall-over-precision, bounded by
a restart limit), `auto-language.lib.mjs` (statistical, thresholded),
`option-suggestions.lib.mjs` (filters yargs' own closed option registry, not
prose), and the emoji/separator-anchored parsers in `solve.disk-diagnostics`,
`isolation-runner` and `session-resume`, which read machine-generated markers and
carry in-code comments explaining their anchoring — good models to follow.

One deliberate carve-out is worth naming: under
`HIVE_MIND_CODEX_CAPABILITY_STRICT=1` the original defect class is intact by
design — a bad guess from prose still kills the run. That is the point of the
flag, and it is opt-in and off by default.

## Sources

- https://agentskills.io/specification
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://learn.chatgpt.com/docs/plugins
- https://learn.chatgpt.com/docs/build-plugins
- https://learn.chatgpt.com/docs/build-skills.md
- https://learn.chatgpt.com/docs/cli/reference
- https://github.com/openai/codex/blob/main/codex-rs/plugin/src/plugin_id.rs
- https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/startup_sync.rs
- https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/loader.rs
- https://github.com/openai/codex/issues/18115
- https://github.com/openai/codex/issues/30023
- https://github.com/openai/codex/issues/21425
- https://aclanthology.org/2020.acl-main.443/
- https://arxiv.org/pdf/2308.10564
- https://docs.renovatebot.com/modules/manager/regex/
- https://docs.deps.dev/api/v3/
- https://github.com/package-url/purl-spec
- https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms
