# Issue #2102 — analysis

Three defects, one chain. The first one caused the incident; the second explains
why the model could not rescue itself; the third is the trap that would have
swallowed a naive fix for the first.

## Root cause 1 (primary, ours) — the corpus excluded the file the requirement was in

Before this change, the entire requirement corpus was
`readIssueRequirementText`: `gh api repos/{owner}/{repo}/issues/{n}` plus its
comments, concatenated. Nothing else. `provisionCodexCapabilities` then hit:

```js
if (requirements.plugins.length === 0 && requirements.skills.length === 0) return { required: false, plugins: [], codexHome: null };
```

Issue #5 never mentions Superpowers; `AGENTS.md` mentions it 13 times. So the
early return fired, and with it every downstream stage — scoped `CODEX_HOME`
(#2074), `plugin add`, the payload repair ladder (#2088), the
`codex debug prompt-input` visibility probe (#2084), and the
`features.remote_plugin = false` loader override (#2094) — was skipped as a
single unit.

**The detector was never the problem.** Run the shipped detector against the
`AGENTS.md` bytes and it resolves the requirement completely, marks both halves
`explicit` (so #2088 fails them closed), and normalizes the marketplace to the
installable spelling:

```
plugins:  [ 'superpowers@openai-curated' ]
skills:   [ 'superpowers:using-superpowers' ]
explicit: [ 'superpowers:using-superpowers', 'superpowers@openai-curated' ]
```

One caveat found while implementing: `AGENTS.md` prose uses the participle
("Use `superpowers:test-driven-development`", "invoke … from `plugin://…`"),
while the detector's requirement vocabulary was tuned on issue prose. Two
adjustments were needed for real instruction files:

- `REQUIREMENT_WORDS` / `CAPABILITY_PREFIX` now accept `us(?:e|es|ing)`, not just
  the bare imperative.
- Qualification now inherits across a conjunction within one namespace, so
  "invoke `superpowers:verification-before-completion` and
  `superpowers:requesting-code-review`" marks both as explicit rather than only
  the first.

### The fix

`collectCodexCapabilityRequirements` (`src/codex-capability-preflight.lib.mjs`)
replaces the issue-only reader. It builds _segments_, each tagged with a source,
from three places:

1. the issue title/body and each comment (unchanged behaviour),
2. every agent instruction file found by `collectAgentInstructionFiles` under
   `projectDir` — which already exists at preflight time
   (`src/codex.lib.mjs:757` passes `projectDir: tempDir`), so this costs no
   network call,
3. `--require-codex-plugin` and `HIVE_MIND_CODEX_REQUIRED_PLUGINS`.

The walk is bounded on purpose — `maxDepth: 3, maxFiles: 24, maxBytes: 256 KB`
(`INSTRUCTION_WALK_LIMITS`) — and every exclusion is reported in `skipped`
rather than dropped, so a truncated scan looks like a truncated scan in the log
instead of like "nothing to find". `node_modules`, `dist`, `build`, `vendor`,
`venv`, `target`, `out`, `coverage`, `tmp` and `__pycache__` are skipped because
instructions vendored from other projects would invent requirements this task
never had. Hidden directories are skipped except `.codex` and `.github`.
Symlinked directories are not followed, which also makes the walk cycle-free.
`AGENTS.md`/`agents.md`, `CLAUDE.md`/`claude.md` and `.codex/*.md` are read;
`AGENTS_MD_FILENAMES` and `CLAUDE_MD_FILENAME` are reused from
`src/agents-md-claude-support.lib.mjs` rather than re-spelled.

### The false-positive budget

Widening the corpus from issue text to agent-facing prose is the risk this
change carries, so it was measured rather than assumed. Ten real-world
instruction files from large public repositories (Airflow, ruff, workers-sdk,
VS Code, MCP servers, openai/codex itself, openai-python, Svelte, Turso,
Next.js — 110 KB total) were scanned with the shipped detector
(`raw/false-positive-scan.log`):

```
Total detections across 10 real-world instruction files: 4
```

All four are bare skill-shaped tokens (`performance-investigation`,
`dce-edge`, `pr-status-triage`, `router-act`), none qualified, so all four are
`explicit: false` — advisory under #2077 and structurally incapable of failing a
run closed. Zero plugin selectors were detected in any of the ten. One file
(Airflow, 35 KB) was rejected by the path guard, which is the intended
behaviour, visible in the log.

## Root cause 2 (upstream, OpenAI) — `request_plugin_install` cannot install under `codex exec`

Verified from source at `rust-v0.145.0` (annotated tag →
`25af12f7e61572b0bc18ddb1008be543b91519b0`); full line-numbered excerpts in
`raw/upstream-codex-0.145.0-verification.log`. There are **two** independent
barriers, and the issue's error message is only the first:

1. **Exact string match against a server-supplied list.**
   `request_plugin_install.rs:153` is `tool.id() == requested_tool_id` — plain
   equality, no normalization, no marketplace aliasing. The failure branch at
   `:176-178` formats the exact message seen in production. The candidate list
   comes from `GET {chatgpt_base_url}/ps/plugins/suggested?scope=GLOBAL`
   (`remote.rs:855-867`), capped at 50 (`MAX_RECOMMENDED_PLUGINS`). No
   `config.toml` key adds an entry, so a repository cannot make its mandatory
   plugin installable this way.
2. **Even a matching id only asks.** `request_plugin_install.rs:215-237` emits an
   MCP elicitation and installs only `if user_confirmed`, i.e. only on
   `ElicitationAction::Accept`. And `exec/src/lib.rs:1662-1666` auto-cancels
   every elicitation, with the comment _"Exec auto-cancels elicitation instead of
   surfacing it interactively."_

So in a headless solver this tool can never succeed — not because of our
account's suggestion list, but by construction. **Provisioning before
`codex exec` is the only path that can ever work.** Even the open upstream PR
[openai/codex#31694](https://github.com/openai/codex/pull/31694) (still unmerged)
would not change this: it widens the allowlist, it does not remove the
elicitation.

### The fix

`request_plugin_install` is a Codex builtin (`tool_origin="builtin"`), so its
rejection is never an NDJSON `item` — it arrives only on OTEL text lines that
`JSON.parse` throws on. The parser was discarding precisely the bytes that
explained the failure.

`matchCodexPluginInstallRejection` (`src/codex-health.lib.mjs:149`) is called
from `parseCodexExecJsonOutput`'s raw-line `catch` (`src/codex.lib.mjs:378`) and
recognizes both shapes — the `codex.tool_result` line (which carries the
`plugin_id` and `call_id`) and the bare `codex_core::tools::router` error line.
Both regexes are line-start anchored, per #1955: Codex replays command stdout
into its own stream, so a detector that matched anywhere in a line would fire on
a `grep` of a log file.

`getCodexPluginProvisioningHealth` (`:163`) then decides:

- rejection seen **and** `fileChanges` is empty → `healthy: false`, the run fails
  with a named diagnostic, reasons that distinguish "the preflight detected
  nothing" from "the preflight ran but the model wanted something else", and
  guidance quoting the _normalized_ selector to use with
  `--require-codex-plugin`;
- rejection seen **but** the run still produced file changes → a warning, not a
  failure. The model asked, was refused, and worked anyway; failing that run
  would be a regression.

The gate sits at `src/codex.lib.mjs:1288-1293`, immediately before the #1990
completion gate, and preserves resume semantics (`argv.resume = sessionId`).

Empirical confirmation on the real incident bytes
(`raw/green-02-production-log-replay.log`): both transcripts yield
`healthy=false detected=true producedWork=false`,
`requestedPlugins=superpowers@openai-curated-remote`, with the two rejection
sources `tool_result` and `router`, and the call ids
`call_ccuteZ4s1AdV1wKVgJdt0Fk5` / `call_ITzX3fjc0OCnTmjE7Q0iMCSp`.

## Root cause 3 (latent, ours) — the two marketplace spellings

`AGENTS.md` says `superpowers@openai-curated-remote`.
`normalizePluginSelector` rewrites `@openai-curated-remote` →
`@openai-curated`. **That rewrite is correct and must stay.** It looks like a
bug (the repository asked for X, we install Y) which is exactly why the CLI
evidence is now recorded in a comment next to it:

```console
$ codex plugin list --available --json | jq '[.available[].marketplaceName] | unique'
[ "codex-warp", "openai-curated" ]          # 180 entries, no "openai-curated-remote"

$ codex plugin add superpowers@openai-curated-remote
Error: plugin `superpowers` was not found in marketplace `openai-curated-remote`
```

Upstream they are genuinely distinct: `OPENAI_CURATED_MARKETPLACE_NAME =
"openai-curated"` (`core-plugins/src/lib.rs:26`) is the local marketplace
`plugin add` installs from; `REMOTE_GLOBAL_MARKETPLACE_NAME =
"openai-curated-remote"` (`remote.rs:69`) is the synthesized namespace the
recommended-plugin list is built under (`remote.rs:888-891` constructs every
recommended `PluginId` with it). `plugin://…` is a mention URI for
already-installed plugins, unrelated to installation. The model asked for the
remote spelling because that is the spelling the repository copied out of a
`plugin://` URI — and the spelling upstream's own recommendation machinery uses.

The trap: installing into `openai-curated` means the remote catalog's merge
deletes it again, which is why #2094 writes `features.remote_plugin = false`
into the scoped home. That override lives inside
`configureScopedPluginLoader`, which the early return skipped. **Fixing root
cause 1 re-arms #2094 automatically** — the three defects are one chain, and the
regression test asserts the re-arming rather than trusting it.

## The failure mode that made this expensive

A skipped preflight was indistinguishable from a healthy one. Both printed
nothing. `grep -c "capability preflight"` returns 0 for both runs, and both ran
with `--verbose`.

So the zero-requirement path now logs, at verbose level
(`src/codex-capability-preflight.lib.mjs:791`):

```
🔌 Codex capability preflight: no plugin or skill requirements detected (sources: issue #5, 2 comments, AGENTS.md, packages/gcs-engine/AGENTS.md)
```

Naming the _sources scanned_ is what converts a repeat occurrence from a
two-session investigation into a five-second diagnosis: if `AGENTS.md` is in the
list and nothing was detected, the detector is at fault; if it is absent, the
walk is.

## Why `✅ Codex command completed` was reported at all

Worth stating plainly, because it is the second-order defect: `codex exec` exited
0 with `turn.completed=1`, so the #1990 completion gate was legitimately
satisfied — the turn _was_ complete, its content was a refusal. Nothing
downstream inspected whether the session produced work. The result was a PR with
`changed_files: 0` that received **two** `## ✅ Ready to merge — All CI checks
have passed` comments, one per run. `getCodexPluginProvisioningHealth`'s
`fileChanges`-empty condition closes exactly this class of empty success for the
plugin case; the general case (a complete turn that produces nothing) remains a
separate gap and is called out in `requirements.md`.
