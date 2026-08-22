# Issue #2094 — the remote catalog discarded the local curated plugin

## Result

The missing Superpowers skills were not rejected by manifest, frontmatter,
permissions, symlink, cache, or repository discovery validation. Codex removed
the entire locally configured plugin **before those loader stages ran**.

In Codex 0.144.6, ChatGPT authentication plus the enabled `remote_plugin`
feature activates the remote global catalog. Its plugin merge function then
removes every configured plugin whose marketplace is exactly
`openai-curated`, before adding the server's remotely installed plugin set.
The production account had no remote Superpowers installation, so the local
plugin disappeared and the model received only five built-in skills.

The relevant upstream code is pinned at Codex tag `rust-v0.144.6`:

- [`manager.rs`: the catalog is active for Codex-backend auth when the feature is enabled](https://github.com/openai/codex/blob/5d1fbf26c43abc65a203928b2e31561cb039e06d/codex-rs/core-plugins/src/manager.rs#L474-L476)
- [`loader.rs`: local `openai-curated` entries are removed before remote entries are merged](https://github.com/openai/codex/blob/5d1fbf26c43abc65a203928b2e31561cb039e06d/codex-rs/core-plugins/src/loader.rs#L204-L217)

That is the first boundary where the plugin disappears. It also explains why
the prior reinstall loop could never help: it repaired state that the next
stage intentionally discarded.

## Production signature

The July 20, 2026 `solve v2.8.10` rerun used Codex 0.144.6 and the continued
CEHR2005/GCS-TS PR #4 checkout at commit
`97a30855f7d284fc94cd906c253992aef1a6e786`. The preflight observed:

| Signal                | Result before this fix                            |
| --------------------- | ------------------------------------------------- |
| Scoped config         | `superpowers@openai-curated`, enabled             |
| Materialized payload  | one version, all 14 `SKILL.md` files              |
| `codex plugin list`   | installed and enabled                             |
| First `prompt-input`  | five built-ins, zero Superpowers skills           |
| Forced reinstall      | succeeded; all 14 files still present             |
| Second `prompt-input` | the same five built-ins                           |
| `codex exec`          | correctly blocked by #2089's fail-closed behavior |

The exact mismatch is expected from the upstream merge: `plugin list` reports
local configuration and cache state, while prompt construction first replaces
the reserved marketplace with remote installed state.

## What the override trades away

`remote_plugin = false` also suppresses the account's remote _discoverable_ and
remotely installed plugin sets for that scope
([`manager.rs`](https://github.com/openai/codex/blob/5d1fbf26c43abc65a203928b2e31561cb039e06d/codex-rs/core-plugins/src/manager.rs#L849)).
This is the deliberate direction of the trade: the reserved marketplace is
replaced rather than merged, so the choice is between the account's partial
remote bundle and the complete local payload Hive provisioned for the explicit
requirement. The override is written only inside the repository-scoped home,
only when capability resolution selected a local `@openai-curated` plugin, and
never for personal marketplaces or the operator home. A capability that exists
only remotely would not have resolved from the local catalog in the first place,
so it cannot be silently lost here.

Scoping matches upstream exactly. The destructive filter compares against
`OPENAI_CURATED_MARKETPLACE_NAME` alone, not the broader
`is_openai_curated_marketplace_name` helper that also accepts
`openai-api-curated`, so Hive checks for exactly `openai-curated` and does not
disable the remote catalog for marketplaces Codex never filters.

## Controlled matrix

The real-CLI reproduction is
[`experiments/issue-2094/reproduce-curated-loader-boundary.sh`](../../../experiments/issue-2094/reproduce-curated-loader-boundary.sh).
It copies authenticated runtime state into disposable homes, preserves the
same payload, config, cwd, and executable, and changes only
`features.remote_plugin`.

Observed with `/home/box/.bun/bin/codex` (`codex-cli 0.144.6`) from the actual
GCS-TS PR checkout:

| Home                                            |        `remote_plugin=true` | `remote_plugin=false` |
| ----------------------------------------------- | --------------------------: | --------------------: |
| copied operator home                            | 8 remote Superpowers skills |   all 14 local skills |
| nested `hive-mind/repositories/CEHR2005/GCS-TS` |             8 remote skills |   all 14 local skills |
| fresh non-nested home                           |             8 remote skills |   all 14 local skills |

The account's remote state changed after the production failure (from zero to
eight Superpowers skills), but the diagnostic remains decisive: the remote set
**replaces** the complete local set. It does not merge with it. With the
production remote set, the first column was zero.

That script needs an authenticated home, so it cannot be run by a reviewer
without one. The claim it cannot cover on its own — that the scoped
`config.toml` Hive writes is genuinely consumed by the loader rather than
silently ignored — is checked by
[`experiments/issue-2094/verify-remote-plugin-config-key.sh`](../../../experiments/issue-2094/verify-remote-plugin-config-key.sh),
which needs only a Codex CLI. Against `codex-cli 0.144.6` it confirms that a
mistyped value is rejected with `invalid type: string "banana", expected a
boolean ... in features` (proving the key is deserialized from the file), that
the exact scoped config shape written by the fix loads and still renders a
prompt, and that an unrecognized `[features]` key is ignored rather than fatal.
The last point bounds the blast radius of an upstream rename: the override would
degrade to a no-op and #2089's fail-closed probe would still refuse to start a
solver without visible skills.

Writing that key is itself a hazard worth stating. TOML expresses one setting in
three ways — a `[features]` header table, a root-scope dotted `features.remote_plugin`,
and an inline `features = { … }` — and the dotted spelling is the one Codex's own
CLI documents. Appending a `[features]` table beside any of the others yields a
duplicate key, and Codex then refuses to load the config at all, which would
break every Codex invocation for that repository rather than only the plugin.
The editor therefore rewrites whichever spelling exists, replaces any existing
value rather than only a boolean literal, keeps an attached comment, and ignores
table headers that appear inside multi-line strings.
[`experiments/issue-2094/toml-editor-cases.mjs`](../../../experiments/issue-2094/toml-editor-cases.mjs)
checks 30 operator config shapes by parsing every produced document with a real
TOML parser (python `tomllib`), and
[`verify-toml-editor-against-cli.mjs`](../../../experiments/issue-2094/verify-toml-editor-against-cli.mjs)
feeds the rewritten documents to an unauthenticated Codex CLI, where all seven
previously rejected shapes now load (`codex-cli 0.144.6`). The same shapes are
asserted in the regression test.

Additional controls:

- The renamed personal marketplace from the #2088 real-CLI experiment exposes
  all 14 skills with `remote_plugin` enabled. The new regression test preserves
  that setting for `superpowers@personal`.
- `auth_mode=chatgpt` is copied into every real matrix home. The regression
  models the same auth state; the upstream predicate explains why direct API
  auth does not activate this branch.
- Cwd does not change the result. The production fix nevertheless runs catalog,
  install/remove, and prompt probes from the exact target checkout used by
  `codex exec`, eliminating repository discovery as a hidden variable.
- The live verification ran inside Docker (`/.dockerenv` present), where the
  operator home was mounted at `/home/box/.codex`. The scoped state is a subtree
  of that mount. The regression also asserts the direct environment handoff and
  Docker mount mapping.
- The first regression run creates fresh state; the second simulates a continued
  PR/restarted process and performs no reinstall. Existing #2088 coverage
  verifies isolation between two repository scopes.

## Filesystem and validation audit

The continued target scope resolved to
`/home/box/.codex/hive-mind/repositories/CEHR2005/GCS-TS`. The marketplace
symlink resolved to `/home/box/.codex/.tmp/plugins`; its manifest identified
`superpowers` version `5.1.3` with `skills = "./skills/"`. The installed
`using-superpowers/SKILL.md` parsed with `name: using-superpowers`. Directories
were mode `0755`, files were readable (`0644`, with scoped config `0600`), and
all inspected paths were owned by uid/gid 1001. No broken skill symlink or
ownership boundary existed.

`RUST_LOG=codex_core_plugins=trace,codex_core_skills=trace` showed the remote
installed bundle synchronization but no per-plugin rejection warning. That is
consistent with the source: filtering the local reserved-marketplace map is a
normal reconciliation branch, not a validation error, so the plugin never
reaches manifest or skill validation. Hive's verbose diagnostic now names that
boundary explicitly.

## Fix

After capability resolution, Hive checks the selected plugin marketplaces. If
the run needs a locally provisioned `@openai-curated` plugin, it writes
`remote_plugin = false` only into that repository's scoped `config.toml`. This
makes the complete local curated snapshot authoritative for that solver session.
It does not mutate the operator home, affect personal marketplaces, vendor a
plugin into the target repository, or name Superpowers in production logic.

The prompt probe and `codex exec` now share one base environment, the same
scoped `CODEX_HOME`, and the same checkout cwd. Execution still starts only
after every explicit skill is present in `<skills_instructions>`; the #2089
fail-closed and heuristic-advisory paths are unchanged.

## Real target verification

Running the fixed preflight against CEHR2005/GCS-TS issue #3 and the continued
PR #4 checkout produced 19 model-visible skills: five built-ins plus all 14
Superpowers skills. All six explicitly required target skills verified without
a repair or reinstall.

An actual Codex solver session was then started in that checkout with the same
scoped environment. Session `019f81b6-6903-7991-9e38-1ac7cd0700d2` announced
and loaded `superpowers:using-superpowers`, read its Codex tool mapping, and
completed with `CAPABILITY_VERIFIED`; it modified no files. This demonstrates
that the capability crosses prompt construction and is usable inside the
solver, not merely present in a synthetic cache check.

## Automated coverage

`tests/test-issue-2094-codex-curated-loader-boundary.mjs` reproduces the exact
0.144.6 merge semantics: valid plugin metadata, full payload, installed/enabled
CLI state, ChatGPT auth, and a prompt missing the curated skills. It covers the
reserved/personal comparison, nested scope, target cwd, fresh/continued runs,
shared prompt/exec environment, and Docker mount. The older visibility,
fail-closed, heuristic, payload repair, restart, and repository-isolation suites
remain part of the default test run.
