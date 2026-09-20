# Issue #2102 — research

What was checked before writing code: the upstream mechanics (from source, not
from the error string), whether anyone has already reported the exec-mode dead
end, and whether an existing component in this repository or outside it already
solves the "collect the repository's agent instructions" problem.

## Upstream mechanics, verified from source

Full line-numbered excerpts: `raw/upstream-codex-0.145.0-verification.log`.
Everything below is openai/codex at annotated tag `rust-v0.145.0` →
`25af12f7e61572b0bc18ddb1008be543b91519b0` (resolved via
`gh api repos/openai/codex/git/refs/tags/rust-v0.145.0`), which is the exact
version the failing runs reported in their telemetry (`app.version=0.145.0`).

| Claim                                                         | Where                                                                       | Verdict   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | --------- |
| `plugin_id` is matched by exact string equality               | `core/src/tools/handlers/request_plugin_install.rs:153`                     | confirmed |
| The production error string is that branch's message          | `request_plugin_install.rs:176-178`                                         | confirmed |
| Install happens only after an accepted MCP elicitation        | `request_plugin_install.rs:215-237`                                         | confirmed |
| `codex exec` auto-cancels every elicitation                   | `exec/src/lib.rs:1662-1666`                                                 | confirmed |
| The candidate list is fetched from the ChatGPT backend        | `core-plugins/src/remote.rs:855-867` (`/ps/plugins/suggested?scope=GLOBAL`) | confirmed |
| The list is capped at 50 entries                              | `core/src/context/recommended_plugins_instructions.rs:6,21`                 | confirmed |
| `openai-curated` ≠ `openai-curated-remote` upstream           | `core-plugins/src/lib.rs:26` vs `core-plugins/src/remote.rs:69`             | confirmed |
| Recommended ids are built under the _remote_ marketplace name | `core-plugins/src/remote.rs:888-891`                                        | confirmed |

The load-bearing consequence is the conjunction of rows 3 and 4: even if
Superpowers appeared in the account's suggestion list, `request_plugin_install`
under `codex exec` would emit an elicitation that `exec` immediately cancels, so
`user_confirmed` is `false` and `completed` is `false`. This is not a
configuration problem with a configuration fix. It closes the question "can the
model self-provision?" with a permanent no, which is why the diagnostic added in
this PR points at the preflight rather than suggesting a retry.

## Is there anything to wait for upstream?

- [openai/codex#31694](https://github.com/openai/codex/pull/31694) — "Allow
  plugin installs for backend dependency IDs", `state: open`, `merged: false`,
  created 2026-07-09. Acknowledges the rejection ("Today
  `request_plugin_install` rejects those IDs before the user can see the normal
  install elicitation") but only widens the allowlist. Per the elicitation
  finding, merging it would still not help `codex exec`.
- No existing issue describes the headless dead end. Searched
  `request_plugin_install` and `recommended_plugins` across openai/codex; the
  nearest neighbours are #33269 (feature request: let Codex discover and
  recommend marketplace plugins), #31894 (exec does not expose exec/code-mode
  tools on Responses Lite turns), #26377 and #25786 (desktop install/auth
  issues), #32035 (desktop resume). None mention elicitation auto-cancel or
  headless installs.

**Action taken:** filed
[openai/codex#35387](https://github.com/openai/codex/issues/35387) on
2026-07-25T20:27:23Z — _"codex exec: request_plugin_install can never install a
plugin (exact-match allowlist, then auto-cancelled elicitation) and the error
message misdescribes why"_. It carries the standalone reproduction (a three-line
`AGENTS.md` plus one `codex exec` invocation), the redacted production telemetry,
the two-barrier explanation with `rust-v0.145.0` line references, both thread
ids, the workaround below, and three concrete suggestions: fail fast with a
message naming the real constraint, offer a non-interactive install path for
headless runs, and have the rejection state which ids _were_ acceptable. The
filed text is archived verbatim at
`raw/upstream-report-openai-codex-35387.md` so this case study does not depend on
the upstream issue surviving.

It also reports the two secondary papercuts we hit: that `plugin add` does not
accept the `-remote` spelling that the recommendation list hands out, and that
`features.remote_plugin = false` is required to keep a locally added plugin
visible.

**Action not taken:** nothing in this repository waits on upstream. The fix is
complete without it.

## Existing components surveyed

The instinct on seeing "walk the repo for instruction files" is to reach for a
library. Four candidates were considered:

1. **`src/agents-md-claude-support.lib.mjs` (this repository).** Already knows
   the filenames and already reads the root file — but only the root file, and
   only to _present_ `AGENTS.md` to Claude Code under the name `CLAUDE.md`
   (`findAgentsMdFile` loops `AGENTS_MD_FILENAMES` at `tempDir` and stops).
   **Reused, not duplicated:** `AGENTS_MD_FILENAMES` and `CLAUDE_MD_FILENAME`
   were changed from module-private to `export const`, and the preflight builds
   its filename set from them. If the project ever renames or extends the
   convention, both call sites move together.
2. **Codex's own instruction discovery.** Codex reads `AGENTS.md` itself — that
   is precisely how the model learned the requirement it then could not
   satisfy. But it is read _inside_ the session, after `<recommended_plugins>`
   and `<skills_instructions>` have already been rendered. There is no CLI
   command that reports "the instruction files this session will read", so
   nothing to shell out to. `codex debug prompt-input` reports the rendered
   prompt (which #2084 already uses for skill visibility), not the file list.
3. **A glob library (`fast-glob`, `globby`, `tinyglobby`).** Rejected. The walk
   needs three bounds (depth, count, size), a skip list, no symlink following,
   and — most importantly — it must _report_ what it skipped so a truncated scan
   is visible in the log. A glob returns paths and swallows the reasons. The
   hand-written walk is ~40 lines and adds no dependency; this repository's
   dependency budget is deliberately small.
4. **`@openai/codex` npm package internals.** Not a library surface; the plugin
   loader is Rust, reachable only through the CLI.

Conclusion: reuse the filename constants, write the bounded walk, add nothing to
`package.json`.

## The convention this change respects

[agents.md](https://agents.md/) describes `AGENTS.md` as the place to put
instructions for coding agents, explicitly including _nested_ files that apply to
their subtree — which is exactly the shape GCS-TS uses (root plus
`packages/gcs-engine/AGENTS.md`). A preflight that reads only the issue is
reading the wrong document by convention, not just by accident. The nested case
is why the walk has depth at all rather than being a root-only lookup.

`CLAUDE.md` is scanned for the same reason in reverse: `--tool claude` users put
the same instructions there, and this repository already treats the two names as
interchangeable (component 1 above).

## What the widening costs

Measured, not assumed — `raw/false-positive-scan.log`, ten real instruction
files from large public repositories (110 KB): **4 detections, all advisory,
0 plugin selectors**. Detail in `analysis.md`. The reason this is safe is
structural rather than statistical: #2077 and #2088 already split detections into
_qualified/explicit_ (may fail a run closed) and _bare/heuristic_ (advisory), and
prose in instruction files overwhelmingly produces the latter. Widening the input
therefore cannot introduce a new class of hard failure; it can only introduce
verbose-level noise, which `⏭️ Ignored non-capability token` logging already
covers.

## Related Hive Mind issues

| Issue | Relationship                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------- |
| #2074 | Established the scoped `CODEX_HOME` and the "provision before `codex exec`" invariant this relies on |
| #2077 | Advisory-vs-explicit split — the reason corpus widening is safe                                      |
| #2080 | Structured-scalar rejection — re-checked against real `AGENTS.md` files in the false-positive scan   |
| #2084 | `codex debug prompt-input` visibility probe — now reachable on the `AGENTS.md` path                  |
| #2088 | Fail-closed on explicit requirements — inherited unchanged by instruction-file detections            |
| #2094 | `features.remote_plugin = false` — re-armed by fixing detection; asserted by the regression test     |
| #1955 | Echo-proofing: Codex replays command stdout, so the new rejection regexes are line-start anchored    |
| #1990 | The completion gate that legitimately passed on a refusal; the new gate sits immediately before it   |
