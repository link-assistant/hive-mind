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
| `probe-pwd.mjs`           | Checks whether `command-stream`'s `cwd` option keeps `PWD` in sync. OpenCode-derived CLIs resolve the project root from `process.env.PWD`, not from the spawn `cwd`, so a raw `spawn({ cwd })` writes files into the parent's directory.                                                                                    |
| `shim/`                   | Fake `claude`/`codex`/`agent`/`opencode`/`qwen`/`gemini` executables that record the argv and stdin the wrapper actually hands them (`shim/_capture.sh`).                                                                                                                                                                   |

### Isolating why `gemini` never does the work (formal-ai#907)

These hold the server, protocol, tool declarations and request constant and vary one
thing each. The first is the positive result; the rest are the hypotheses it replaced.

| Script                        | Question                                                    | Answer                                                                                |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `repro-intent-hijack.sh`      | Does one line of caller framing change what Formal AI does? | **Yes.** `Today's date is …` → `run_shell_command("date")`; remove it → `write_file`. |
| `repro-gemini-protocol.sh`    | Is it the gemini protocol adapter?                          | No — the OpenAI endpoint behaves the same.                                            |
| `repro-preamble-routing.sh`   | Is it the session preamble as such?                         | No — other preambles route correctly.                                                 |
| `repro-system-prompt-size.sh` | Is it prompt size? (swept 0 → 73,438 prompt tokens)         | No.                                                                                   |
| `repro-toolcall-routing.sh`   | Is it the presence of tool declarations?                    | No — tools alone route correctly.                                                     |
| `repro-multipart-parts.sh`    | Is it multi-part turns?                                     | No.                                                                                   |
| `repro-context-keyword.sh`    | Which keyword fires it?                                     | Phrase-level, not keyword-level — bare `date` does not fire it.                       |
| `capture-gemini-request.mjs`  | What does gemini actually send?                             | Records the real 48 KB request through `proxy-capture.mjs`.                           |
| `proxy-capture.mjs`           | —                                                           | Recording HTTP proxy: `node proxy-capture.mjs <port> <upstream> <captureFile>`.       |

### Other reproductions

| Script                              | What it establishes                                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repro-headless-config-gaps.sh`     | `formal-ai with <tool> --global` writes a config `gemini` and `qwen` both refuse to start from (formal-ai#909). Runs each CLI with the `--global` env alone, then with the missing piece. |
| `repro-agent-interactive-stdin.mjs` | **Negative result.** `agent` 0.25.5 exits 0 in 4 s on closed piped stdin, with and without the injected `--interactive`. It does not hang; no `link-assistant/agent` issue is warranted.  |
| `repro-codex-c-order.sh`            | codex-cli discards `-c` overrides given before `exec` as soon as any `-c` follows `exec` (formal-ai#902).                                                                                 |
| `repro-with-argv.sh`                | Records the argv `formal-ai with` builds for every client, in both caller shapes (formal-ai#903).                                                                                         |

All of these write into a throwaway `HOME`, so `formal-ai with … --global` never
touches the operator's real `~/.profile`.

## Captured output

`shim-capture-*.txt` / `*-shim-capture.txt` stay here next to the shims that
produced them: they show argv and stdin as delivered by `formal-ai with` — the
flag theft, the argument reordering, and the substituted recovery prompt.
`clients.json` is `formal-ai clients --format json`, the registry the runtime
parses.

Verbatim Formal AI answers captured by the probe scripts live in
`docs/case-studies/issue-2130/data/probes`:

| File                                         | Shows                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `formal-ai-0.317.0-language-extraction.md`   | The language router picking `the` out of a prompt and refusing on `language "missing"`.     |
| `formal-ai-0.317.0-intent-hijack.log`        | One sentence of caller framing flipping the tool call from `write_file` to `date`.          |
| `formal-ai-0.317.0-headless-config-gaps.log` | What `--global` writes per tool, and each CLI's refusal without the missing settings entry. |

Everything else lives in `docs/case-studies/issue-2130/data/runs`:

| File(s)                                                       | Shows                                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `global-*.log`                                                | `formal-ai with --global --no-start-server` per tool: which config file each client writes and in which format.                          |
| `codex-order-*.log`, `codex-workaround*.log`, `repro-codex.*` | `-c` overrides passed after `exec` replacing the global `-c` set → 401 against `api.openai.com`, and the `CODEX_HOME` workaround.        |
| `direct-*.log`                                                | First direct-endpoint runs per tool (before the harness was generalised).                                                                |
| `e2e-*.log`                                                   | Runs of `e2e-direct-endpoint.mjs`; `e2e-run-claude-js.log` is the run where claude emitted 11 `tool_use` events and created `hello.txt`. |
| `e2e-final-*.log`                                             | One six-tool run of `e2e-direct-endpoint.mjs` with the same prompt: every CLI reaches Formal AI and exits 0 (`e2e-final-summary.log`).   |

Logs are kept as captured (sanitized) so the observed behaviour stays reviewable
without re-running against a live Formal AI server.
