# Experiments — issue #2136

Two artefacts backing the case study in `docs/case-studies/issue-2136`.

## `reproduce-parser-confusion.mjs`

Deterministic, offline reproduction of the defect: it feeds the **verbatim**
stdout/stderr split from the incident log (`turn.started` at line 1060, the OTEL
`codex.tool_result` echo at lines 9322–9331, `turn.completed` at line 26634)
through `parseCodexExecJsonOutput` + `getCodexCompletionHealth`, once treating
stderr as protocol (the old behaviour) and once with the `source` separation.

```
$ node experiments/issue-2136/reproduce-parser-confusion.mjs
stderr parsed as protocol (old): turn.started=2 turn.completed=1 → healthy=false  ← the false failure
stderr treated as telemetry (new): turn.started=1 turn.completed=1 → healthy=true
```

## `codex-otel-echo-live.sh`

The recipe for reproducing the **upstream** behaviour (RC4) against a real,
authenticated Codex CLI: ask Codex to run a command whose stdout is NDJSON and
watch it reappear inside a `codex_otel.log_only: … codex.tool_result … output=`
record on stderr.

Running it here on `codex-cli 0.146.0` without credentials stops before the
interesting part — the model never gets to call a tool, so no `tool_result`
record is emitted:

```
{"type":"error","message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header …"}
{"type":"turn.failed", …}
```

so the upstream evidence in the case study comes from the captured production run
(`docs/case-studies/issue-2136/raw/solve-run-ad0c801a-….log.gz`, lines 9322–9331)
rather than from a local re-run.
