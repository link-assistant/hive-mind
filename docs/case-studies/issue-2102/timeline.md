# Issue #2102 — timeline

Reconstructed from the two complete solver transcripts in `raw/` (256,892 and
288,381 bytes, both `solve v2.8.11`, Codex CLI `0.145.0`, `gpt-5.6-sol`,
thinking off, `auth_mode="Chatgpt"`, `originator=codex_exec`), from the GitHub
payloads in `data/`, and from openai/codex at `rust-v0.145.0`.

Both runs used `--verbose`, which matters: the preflight's silence is not a
log-level artifact.

```
/home/box/.nvm/versions/node/v20.20.2/bin/node /home/box/.bun/bin/solve \
  https://github.com/CEHR2005/GCS-TS/issues/5 --tool codex --attach-logs \
  --verbose --no-tool-check --disable-report-issue --language ru
```

## Before the incident — the ground that was already prepared

| When (UTC)           | What                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- |
| 2026-07-17T08:59:37Z | `CEHR2005/GCS-TS` created                                                                   |
| ~2026-07-20 → 07-22  | #2074, #2077, #2080, #2084, #2088, #2094 land — the whole provisioning pipeline is repaired |
| 2026-07-22           | v2.8.11 released, containing the #2094 `features.remote_plugin = false` fix                 |
| 2026-07-23T10:54:40Z | GCS-TS `main` last pushed; `AGENTS.md` declares the mandatory Superpowers workflow          |

`AGENTS.md` (root, 3,249 bytes) and `packages/gcs-engine/AGENTS.md` (1,187 bytes)
are both normative. The root file states the requirement three ways: a skill to
invoke (`superpowers:using-superpowers`), a plugin to install
(`superpowers@openai-curated-remote`), and a prohibition on falling back
(`No manual workflow fallback is authorized`).

Issue #5's body is a pure engineering spec — GCS v5 trait bonus calculation,
acceptance criteria, a Docker gate. The string `superpowers` does not appear in
it, nor in any comment that existed at solve time. That is the whole bug in one
sentence: the requirement was written where a repository is _supposed_ to write
it, and read from a place that never contained it.

## Run 1 — 2026-07-23T12:15:26Z → 12:19:31Z

| Time (UTC)        | Line | Event                                                                                                                                                                                                                                                           |
| ----------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `12:15:26.109`    | 1    | Log opens                                                                                                                                                                                                                                                       |
| `12:15:30.149`    | 6    | `🚀 solve v2.8.11`                                                                                                                                                                                                                                              |
| `12:15:30.829`    | 10   | `🧭 Execution context: docker container`                                                                                                                                                                                                                        |
| `12:15:53.000`    | 287  | Fork prepared, branch `issue-5-e57b5459a453`, PR #6 opened as draft                                                                                                                                                                                             |
| **no line**       | —    | **`🔌 Codex capability preflight` — never emitted. `grep -c` → 0.**                                                                                                                                                                                             |
| `12:16:17.703`    | 354  | `codex exec --model gpt-5.6-sol --json … --dangerously-bypass-approvals-and-sandbox`                                                                                                                                                                            |
| `12:16:19.910`    | 580  | `📌 Session ID: 019f8ee7-ba09-7482-8087-b93f7bb7940f`                                                                                                                                                                                                           |
| `12:16:27.986`    | 838  | Model searches for the capability: `tool_search` "install exact plugin superpowers@openai-curated-remote and invoke plugin skills superpowers using-superpowers" → returns only the Plugin Management namespace                                                 |
| `12:16:31.963987` | 911  | `tool_result tool_name=request_plugin_install call_id=call_ccuteZ4s1AdV1wKVgJdt0Fk5 arguments={"plugin_id":"superpowers@openai-curated-remote",…} duration_ms=0 success=false output=plugin_id must match one of the entries in the <recommended_plugins> list` |
| `12:16:31.965122` | 914  | `ERROR codex_core::tools::router: error=plugin_id must match one of the entries in the <recommended_plugins> list`                                                                                                                                              |
| `12:16:38.988`    | 943  | `item.completed` agent*message: *"Работа остановлена до инспекции реализации и без изменений в worktree — этого требует `AGENTS.md`."\_ — the model quotes the rejection verbatim                                                                               |
| `12:16:39.451`    | 1084 | `📊 Codex JSON events: thread.started=1, turn.started=1, item.completed=3, turn.completed=1`                                                                                                                                                                    |
| `12:16:39.811`    | 1086 | `💰 Codex public pricing estimate: $0.148880`                                                                                                                                                                                                                   |
| `12:16:39.814`    | 1083 | **`✅ Codex command completed`**                                                                                                                                                                                                                                |
| `12:16:39.879`    | —    | `📊 [DISK] phase=after_agent … delta=+3 KB` — three kilobytes, all of it log noise                                                                                                                                                                              |
| `12:16:44.610`    | 1122 | Working-session-summary comment posted to PR #6 (the model's Russian text, verbatim, as if it were a result)                                                                                                                                                    |
| `12:16:51.984`    | 1163 | `✓ Pull request CEHR2005/GCS-TS#6 is marked as "ready for review"`                                                                                                                                                                                              |
| `12:17:05Z`       | —    | Solution-draft-log comment: 23.5K input + 38.4K cached, 406 output, **$0.148880**                                                                                                                                                                               |
| `12:19:31Z`       | —    | **`## ✅ Ready to merge` — "All CI checks have passed, No merge conflicts"** on a PR with `changed_files: 0`                                                                                                                                                    |

Total elapsed inside Codex: 22 seconds. Total work product: zero files.

## Between the runs

| Time (UTC)  | Who      | What                                                                         |
| ----------- | -------- | ---------------------------------------------------------------------------- |
| `13:02:23Z` | CEHR2005 | Comments on PR #6: **"you need to install superpowers plugin before start"** |
| `13:02:31Z` | CEHR2005 | Same comment on issue #5                                                     |

The repository owner diagnosed it correctly, in eight words, before we did. "Before
start" is the operative phrase: they are describing the preflight, not the model.

## Run 2 — 2026-07-23T13:14:47Z → 13:18:54Z

Structurally identical. The owner's comment now exists in the issue corpus, but
it says "superpowers plugin" without a marketplace qualifier — so under #2077's
false-positive protection it is a bare, advisory mention, not an explicit
requirement, and it still provisions nothing.

| Time (UTC)        | Line | Event                                                                           |
| ----------------- | ---- | ------------------------------------------------------------------------------- |
| `13:14:51.898`    | 6    | `🚀 solve v2.8.11`                                                              |
| `13:15:26.144`    | 186  | PR #6 converted back to draft                                                   |
| **no line**       | —    | **preflight silent again**                                                      |
| `13:15:40.027`    | 278  | `codex exec …`                                                                  |
| `13:15:42.667`    | 522  | `📌 Session ID: 019f8f1e-168f-77d1-b70f-c0030dab63f7`                           |
| `13:16:03.210776` | 826  | `request_plugin_install call_id=call_ITzX3fjc0OCnTmjE7Q0iMCSp` → same rejection |
| `13:16:03.210917` | 828  | `ERROR codex_core::tools::router: error=plugin_id must match …`                 |
| `13:16:08.161`    | 850  | agent*message: *"Работа остановлена до реализации, как требует `AGENTS.md`."\_  |
| `13:16:09.279`    | 988  | **`✅ Codex command completed`**                                                |
| `13:16:26Z`       | —    | Solution-draft log: 23.2K input + 58.6K cached, 567 output, **$0.162142**       |
| `13:18:54Z`       | —    | **Second `## ✅ Ready to merge`** on the same zero-diff PR                      |

Run 2 also emitted three `update_plan` calls that run 1 did not — the model
planned the work, then correctly refused to do it.

Cumulative cost of the two sessions: **$0.311022**. Cumulative diff: **0 files,
0 additions, 0 deletions** — the PR's two commits are `39d3e848 "Initial commit
with task details"` and `c2464138 "Revert \"Initial commit with task details\""`,
i.e. solve's own placeholder and its removal. Nothing else was ever written.

## Why it read as success

Three independent signals all reported healthy:

1. `codex exec` exited 0 and emitted `turn.completed=1` — so the #1990
   completion gate was satisfied. It _was_ a complete turn; the turn's content
   was a refusal.
2. The model's own summary was posted as the working-session summary. Written in
   Russian (`--language ru`), it reads like a report, and it is a report — of a
   failure — but nothing in the pipeline classified it as one.
3. The auto-merge check found no CI failures and no conflicts, because there was
   nothing to check.

`request_plugin_install` is a Codex builtin (`tool_origin="builtin"`), so its
rejection never appears as an NDJSON `item` — only on OTEL text lines that
`JSON.parse` rejects. The parser was discarding exactly the bytes that explained
the failure. That is the specific hole the new detector fills.

## The fix, applied to these same bytes

| Time (UTC)           | What                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-25T14:12:35Z | konard files #2102 with the three root causes already separated                                                                    |
| 2026-07-25T17:42:01Z | konard's follow-up comment: redo it, compile the data, deep case study, report upstream, apply everywhere                          |
| `8d410605`           | RED — the regression test, committed before the fix (`raw/red-01-collect-missing.log`)                                             |
| `a0cf41c5`           | GREEN — corpus extension, zero-requirement logging, rejection diagnostic, escape hatch (`raw/green-01-fix-applied.log`)            |
| —                    | Replay of both production transcripts through the shipped code: `healthy=false` on both (`raw/green-02-production-log-replay.log`) |

The replay is the closing of the loop: the same bytes that produced
`✅ Codex command completed` now produce
`❌ Codex could not obtain a required plugin at runtime — treating as failure`,
with guidance naming `--require-codex-plugin superpowers@openai-curated`.
