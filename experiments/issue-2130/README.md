# Experiments for issue #2130

Scripts used to find the root cause of `--model formal-ai` failing on a
hello-world issue, and to verify the fix.

The full write-up lives in [`docs/case-studies/issue-2130`](../../docs/case-studies/issue-2130);
the captured output of these scripts is stored alongside it in
[`data/runs`](../../docs/case-studies/issue-2130/data/runs) (`experiments/**/*.log`
is covered by `.gitignore`, `docs/case-studies/**/*.log` is not).

## Scripts

| Script                    | What it does                                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e-direct-endpoint.mjs` | Live end-to-end harness for the fix. Starts `formal-ai serve --agent-mode`, materialises the per-client config in an isolated HOME, then runs the **native** CLI with the resulting environment. Usage: `node e2e-direct-endpoint.mjs claude agent codex qwen gemini opencode`; override the prompt with `HIVE_E2E_PROMPT`. |
| `probe-stdin.mjs`         | Minimal reproduction of the `formal-ai with` wrapper consuming stdin without forwarding it once a workspace-effect keyword (`create`/`write`/`implement`) appears anywhere in argv.                                                                                                                                         |
| `repro-claude-*.mjs`      | Variants that isolate which layer drops the prompt: raw `spawn` (`-spawn`), command-stream (`-command-stream`), the full Hive Mind claude path (`-full`), the keyword that flips the wrapper into recovery mode (`-trigger`), and the fixed path (`-fix`).                                                                  |
| `shim/`                   | Fake `claude`/`codex`/`agent`/`opencode`/`qwen`/`gemini` executables that record the argv and stdin the wrapper actually hands them (`shim/_capture.sh`).                                                                                                                                                                   |

## Captured output

`shim-capture-*.txt` / `*-shim-capture.txt` stay here next to the shims that
produced them: they show argv and stdin as delivered by `formal-ai with` — the
flag theft, the argument reordering, and the substituted recovery prompt.
`clients.json` is `formal-ai clients --format json`, the registry the runtime
parses.

Everything else lives in `docs/case-studies/issue-2130/data/runs`:

| File(s)                                                       | Shows                                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `global-*.log`                                                | `formal-ai with --global --no-start-server` per tool: which config file each client writes and in which format.                          |
| `codex-order-*.log`, `codex-workaround*.log`, `repro-codex.*` | `-c` overrides passed after `exec` replacing the global `-c` set → 401 against `api.openai.com`, and the `CODEX_HOME` workaround.        |
| `direct-*.log`                                                | First direct-endpoint runs per tool (before the harness was generalised).                                                                |
| `e2e-*.log`                                                   | Runs of `e2e-direct-endpoint.mjs`; `e2e-run-claude-js.log` is the run where claude emitted 11 `tool_use` events and created `hello.txt`. |

Logs are kept as captured (sanitized) so the observed behaviour stays reviewable
without re-running against a live Formal AI server.
