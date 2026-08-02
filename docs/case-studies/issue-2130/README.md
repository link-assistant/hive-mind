# Case Study: `--model formal-ai` still not working on the simplest hello world (#2130)

> Companion data lives next to this file. Every claim below cites a stored artefact
> so it can be re-checked without re-running anything:
>
> | Folder                               | Contents                                                                                                                                      |
> | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
> | [`data/tool-logs/`](data/tool-logs/) | The seven distinct solver logs the issue links to, plus [`index.json`](data/tool-logs/index.json) mapping each gist → PR comment → byte size. |
> | [`data/github/`](data/github/)       | `gh api` captures of the six `test-hello-world-*` repositories (repo, issues, pulls, issue comments, commits).                                |
> | [`data/runs/`](data/runs/)           | 46 logs from the reproductions and bisections run while solving this issue.                                                                   |
> | [`data/probes/`](data/probes/)       | Formal AI 0.317.0 answers captured verbatim for a set of hand-written prompts.                                                                |

---

## 1. What the issue reports

Issue [#2130](https://github.com/link-assistant/hive-mind/issues/2130) is the second
round of [#2119](https://github.com/link-assistant/hive-mind/issues/2119) (fixed by
[PR #2120](https://github.com/link-assistant/hive-mind/pull/2120)). The reporter ran
`solve … --model formal-ai` against three freshly generated "hello world" repositories,
one per tool, and none of them produced a working program. The verbatim links:

| Tool     | Started at                                                                                                                                                 | Failure log                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `claude` | [`…698a/pull/2#issuecomment-5158866526`](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5158866526)   | gist `1963a8876911f1087aa868c89839a837` → [`claude-02-FTn7sm.log`](data/tool-logs/claude-02-FTn7sm.log)                            |
| `codex`  | [`…593c/pull/2#issuecomment-5158964914`](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2#issuecomment-5158964914)   | gist `b97b374233894030445443e3da2d24bf` → [`codex-02-rv2k7W.log.gz`](data/tool-logs/codex-02-rv2k7W.log.gz)                        |
| `agent`  | [`…600d5b/pull/2#issuecomment-5158414013`](https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2#issuecomment-5158414013) | 18 restarts, ending at gist `32b1af3dddc10939d2ee8af95a46aa6b` → [`agent-18-V7E0Ee.log.gz`](data/tool-logs/agent-18-V7E0Ee.log.gz) |

The issue explicitly asks for **all** restart logs of the agent run, not just the last —
which is why `index.json` records all 18 uploads. Uploads 1–10 and 13–17 are byte-identical
prefixes of their successors (the log file grows and is re-uploaded whole on every restart),
so only the three logs that add new content are stored verbatim; the `stored: false` entries
keep the gist URL and the byte count so the chain is auditable.

### 1.1 Requirement inventory

Every sentence of the issue that asks for something, numbered so the rest of this document
can refer back:

| #   | Requirement (paraphrased; the issue's own words in quotes)                                                                                                                                                    | Status                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | "First of all we must fix all false positives, false negatives, warnings and errors on Hive Mind side."                                                                                                       | ✅ done, §4               |
| R2  | Report the remaining defects to `link-assistant/formal-ai` and `link-assistant/agent` "where applicable", each with "reproducible examples, workarounds and suggestions for fix the issue in code".           | §6                        |
| R3  | "make sure that Formal AI is fully supported in Hive Mind" for **all** tools — claude, codex, agent, gemini, qwen.                                                                                            | ✅ done, §5               |
| R4  | Agent CLI "should be fully ready to operate Formal AI".                                                                                                                                                       | §5.4 / §6                 |
| R5  | Formal AI "should be able to code by using reasoning" per its own vision.                                                                                                                                     | upstream, §6.1            |
| R6  | "download all logs and data related about the issue to this repository … compile that data to `./docs/case-studies/issue-{id}`".                                                                              | ✅ done, [`data/`](data/) |
| R7  | Deep case study: "reconstruct timeline/sequence of events, list of each and all requirements … find root causes of the each problem, and propose possible solutions and solution plans for each requirement". | ✅ this file              |
| R8  | "check known existing components/libraries, that solve similar problem or can help in solutions".                                                                                                             | ✅ §7                     |
| R9  | "If there is not enough data to find actual root cause, add debug output and verbose mode if not present."                                                                                                    | ✅ §4.7                   |
| R10 | "double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them."                                                                        | ✅ §4.6                   |

---

## 2. Timeline

Times are UTC and come from the `created_at` fields in
[`data/tool-logs/index.json`](data/tool-logs/index.json) and the GitHub captures in
[`data/github/`](data/github/).

| When                   | What                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-09-06 09:42–17:46 | Three reference runs succeed with ordinary LLM models: Rust, Common Lisp and COBOL hello-worlds, one PR each, titles clean. The issue cites them as the target behaviour. Captures: `data/github/01991e68-*`, `01991e7d-*`, `01992020-*`.                                                                                                                                        |
| 2026-07-30 13:21–13:23 | Three new `test-hello-world-*` repositories are generated for the `--model formal-ai` reproduction (`019fb330-00e1…`, `019fb330-fa49…`, `019fb331-c107…`).                                                                                                                                                                                                                       |
| 2026-07-30 14:13–14:33 | Round 1, on **solve v2.10.2**. `agent` restarts 11 times; `claude` and `codex` each fail once. All three PRs are opened with **literally quoted titles** — `'Implement Hello World in Scala'`. This round is what issue #2119 was filed about.                                                                                                                                   |
| 2026-07-30 16:10:50    | [`46b2df22`](https://github.com/link-assistant/hive-mind/commit/46b2df22fab53512e3d0e159e4eceb99e91770a2) — "stop leaking shell quotes into PR titles and API arguments" — lands on `main` via PR #2120, together with the "1 file(s) modified with an empty diff" fix.                                                                                                          |
| 2026-08-02 14:07–15:45 | Round 2, on **solve v2.11.5** (i.e. _with_ the #2119 fix). `agent` restarts 7 more times and hits the 5-iteration auto-restart limit; `claude` fails in 2 s; `codex` fails in 20 s. The PRs are not re-created, so the title fix cannot be observed in these logs — but the underlying `--model formal-ai` failure is unchanged. This round is what issue #2130 was filed about. |
| 2026-08-02 15:53       | Issue #2130 filed.                                                                                                                                                                                                                                                                                                                                                               |

The version split matters and is easy to get wrong: `grep '🚀 solve v' data/tool-logs/*.log*`
shows `claude-01`/`codex-01`/`agent-11` on `v2.10.2` and `claude-02`/`codex-02`/`agent-12`/`agent-18`
on `v2.11.5`. **The PR-title quoting and the empty-diff report visible in the round-1 logs were
already fixed before round 2** and are guarded by `tests/test-shell-quoting-2119.mjs`. Nothing in
this pull request re-fixes them; §4 and §5 deal only with what is still broken in `v2.11.5`.

---

## 3. The single upstream cause behind all three failures

All three tools failed for the same structural reason, visible in one line of every log:

```text
📝 Raw command:
(cd "/tmp/gh-issue-solver-1785679629225" && cat "/tmp/agent_prompt_….txt" | formal-ai with agent --model formalai/formal-ai --verbose)
```

— [`agent-18-V7E0Ee.log.gz:340`](data/tool-logs/agent-18-V7E0Ee.log.gz)

Hive Mind piped its prompt into `formal-ai with <tool> <args…>`, an argv wrapper that starts a
temporary Formal AI server and then re-invokes the native CLI on the caller's behalf. The wrapper
is structurally incompatible with how Hive Mind drives those CLIs. The agent log proves it
directly, because agent 0.25.5 echoes its own `process.argv`:

```json
"processArgv": [
  "/home/box/.bun/bin/bun",
  "/home/box/.bun/install/global/node_modules/@link-assistant/agent/src/index.js",
  "--no-summarize-session", "--compaction-model", "same",
  "--model", "formalai/formal-ai",
  "-p", "--model formalai/formal-ai --verbose"
]
```

— [`agent-18-V7E0Ee.log.gz:466-487`](data/tool-logs/agent-18-V7E0Ee.log.gz)

Three separate defects are visible in that one array:

1. **stdin is dropped.** The prompt arrived on stdin from `cat`; the wrapper never forwarded it.
2. **Flags are stolen and re-injected.** `--no-summarize-session --compaction-model same --model …`
   are the wrapper's, not Hive Mind's.
3. **The caller's trailing arguments are collapsed into one string and handed to `-p` as the prompt.**
   The agent's prompt became the literal text `--model formalai/formal-ai --verbose`.

Because no prompt was ever delivered, the agent fell back to
`"mode": "stdin-stream", "message": "Agent CLI in continuous listening mode"` and idled until
Hive Mind's restart logic gave up after 5 iterations
([`agent-18-V7E0Ee.log.gz:25825`](data/tool-logs/agent-18-V7E0Ee.log.gz)).

The same wrapper produced the other two failures:

- **claude** — `Error: Input must be provided either through stdin or as a prompt argument when using --print`
  ([`claude-02-FTn7sm.log:500`](data/tool-logs/claude-02-FTn7sm.log)), i.e. exactly defect (1), 2 s after start.
- **codex** — every request went to `wss://api.openai.com/v1/responses` and came back
  `401 Unauthorized`
  ([`codex-02-rv2k7W.log.gz:343`](data/tool-logs/codex-02-rv2k7W.log.gz)). The wrapper passes the
  provider configuration as `-c model_providers.…` overrides placed **after** `exec`; codex-cli
  treats `-c` after the subcommand as a _replacement_ of the global `-c` set, so the
  `model_providers` block was wiped and codex fell back to its built-in OpenAI provider.

A fourth, quieter symptom belongs to the same wrapper: in agent mode it decides whether to enter an
"orchestration/recovery" mode by scanning the command line case-insensitively for workspace-effect
keywords (`create`, `write`, `implement`). Hive Mind always passes
`--disallowedTools … CronCreate …`, which always matches, so every run took the orchestration path —
which is the path that consumes stdin and substitutes its own recovery prompt.

---

## 4. Hive-Mind-side defects (R1) — what the logs showed and what changed

R1 asks for false positives, false negatives, warnings and errors on the Hive Mind side to be fixed
**first**. Each item below is driven by a specific line in a stored log.

### 4.1 False negative — "No working session summary available from AI tool output"

agent 0.25.x and OpenCode nest assistant text one level down:

```json
{ "type": "text", "part": { "type": "text", "text": "…" } }
```

The stream parser only read a top-level `data.text`, so `resultSummary` was `null` for **every**
successful run and Hive Mind reported that no summary was available. Fixed in the parsers; covered
by `tests/test-issue-2130-formal-ai-runtime.mjs`.

### 4.2 False positive — `WARNING` from codex on every single run

codex-cli 0.146.0 refuses to create its PATH helper binaries when `CODEX_HOME` lives under the
system temp directory, and prints a warning. Hive Mind put the throwaway Formal AI `HOME` in
`os.tmpdir()`. Moved to `~/.cache/hive-mind/formal-ai`; verified in
[`data/runs/e2e-codex-home-root-fix.log`](data/runs/e2e-codex-home-root-fix.log).

### 4.3 False positive — an expected 404 printed as an error

`checkFileInBranch` asks GitHub whether a file exists on a branch. "Absent" is the normal answer,
but the probe printed `gh: Not Found (HTTP 404)` on a miss and the entire contents payload on a hit
([`claude-02-FTn7sm.log:84,86`](data/tool-logs/claude-02-FTn7sm.log)).

### 4.4 Error — `gh auth setup-git` on a bind-mounted `~/.gitconfig`

```text
failed to set up git credential helper: failed to run git: error: could not write config file
/home/box/.gitconfig: Device or resource busy
```

— [`claude-02-FTn7sm.log:106`](data/tool-logs/claude-02-FTn7sm.log) and
[`codex-02-rv2k7W.log.gz:112`](data/tool-logs/codex-02-rv2k7W.log.gz)

Hive Mind mirrored the raw error and then continued **with no credential helper at all**. It now
falls back to a clone-local helper, so the run keeps working and the message becomes informational.

### 4.5 Wrong remedy — "Please run: codex login"

```text
❌ Error executing Codex command: Codex authentication failed - 401 Unauthorized. Please run: codex login
```

— [`codex-02-rv2k7W.log.gz:765`](data/tool-logs/codex-02-rv2k7W.log.gz)

When the model is served by Formal AI the CLI never talks to the vendor, so `codex login` /
`claude login` is advice that cannot help. `buildAuthRemedyLines` now substitutes Formal-AI-specific
guidance.

### 4.6 Log noise — raw `gh`/`git` payloads mirrored into the attached log (R10)

This is the largest and least obvious item, and the one that most directly produces the "unexplained
errors" impression the issue complains about.

`src/lib.mjs:349` patches `process.stdout.write` and copies everything to the log file that
`--attach-logs` later uploads. That is correct for the AI tool's own output. But command-stream
mirrors every child process's stdout by default, so Hive Mind's own **read-only probes** — the ones
it runs to answer questions about itself — dumped their raw payloads into that log, between the
solver's own sentences, where they read as unexplained output or as errors.

Measured over the stored logs (`[STDOUT]`-tagged bytes ÷ total bytes):

| Log                                                               | Total      | Mirrored `[STDOUT]` | Share  |
| ----------------------------------------------------------------- | ---------- | ------------------- | ------ |
| [`claude-02-FTn7sm.log`](data/tool-logs/claude-02-FTn7sm.log)     | 96,333     | 36,673              | 38.1 % |
| [`codex-02-rv2k7W.log.gz`](data/tool-logs/codex-02-rv2k7W.log.gz) | 336,114    | 36,768              | 10.9 % |
| [`agent-18-V7E0Ee.log.gz`](data/tool-logs/agent-18-V7E0Ee.log.gz) | 4,456,925  | 455,076             | 10.2 % |
| [`agent-11-0JuEzF.log.gz`](data/tool-logs/agent-11-0JuEzF.log.gz) | 11,046,857 | 597,193             | 5.4 %  |

What those bytes are, in `agent-11-0JuEzF.log.gz`:

- **12 copies of a ~33.5 KB pull-request JSON object** — one per watch iteration of
  `checkGitHubTerminalState`, whose only question is "does this PR still exist?".
- **46,070 / 41,504 / 36,938 B comment-list dumps** — the post-finish sanitization sweep paginating
  `…/issues/N/comments`. In `agent-18` the same dump reappears once per restart and grows with the
  conversation: 57,544 → 62,166 → 66,788 → 71,410 → 76,032 → 80,654 B.
- **`konard` on a line by itself, 23 times** — `gh api user --jq .login`.
- **`public`, 12 times** — `gh api repos/…/… --jq .visibility`.
- **`I_kwDO…` and `PR_kwDO…`** — GraphQL node ids fetched to link the issue to the PR.
- **A live credential in clear text** — `gh auth status --show-token`, whose entire purpose is to
  print the token. This one is a security problem, not merely noise: the sanitizer masks tokens it
  _knows about_, and this is the call that discovers them.

The fix is a shared idiom rather than 40 scattered edits. `src/quiet-probe.lib.mjs` exports:

```js
export const QUIET_PROBE = Object.freeze({ mirror: false, capture: true });
export const quietProbe = dollar => {
  /* binds QUIET_PROBE, or returns dollar unchanged */
};
```

`capture: true` is not optional: it is what keeps `result.stdout` available to the caller, so the
probe is silenced without silencing the answer. Two call forms exist because roughly half the
helpers receive `$` as an injected parameter and the doubles callers pass are plain tagged templates
that throw `TypeError: strings.reduce is not a function` on `$({…})`:

- module-owned `$` → `await $(QUIET_PROBE)\`gh api …\``
- injected `$` → `await quietProbe($)\`gh api …\``(memoised per`$`in a`WeakMap`, falls back to
  the tag unchanged, and swallows the thenable a non-configurable tag may return)

`wrapDollarWithGhRetry` was extended to forward command-stream's options-call form, so the idiom
composes with rate-limit retry — all 24 modules build their `$` through that wrapper.

Applied repo-wide (R10) across 20 modules: `github-terminal-state`, `post-finish-sanitization-sweep`,
`token-sanitization`, `github`, `solve.feedback` (12 `gh api` reads and both `git log` date probes),
`git` (`getGitVersionAsync`'s four probes), `solve.auto-pr`, `solve.repo-setup`, `github-error-reporter`,
`solve.fork-sync`, `solve.results`, `solve.execution`, `solve.auto-continue`, `solve.repository`,
`bidirectional-interactive`, `solve.branch-errors`. Sites already using `$({ silent: true })` or a
private `$silent` were left alone.

`tests/test-issue-2130-log-noise.mjs` covers this with 23 tests, including a repo-wide static guard
that fails if any `src/**/*.mjs` reintroduces a bare, mirrored `gh api user --jq .login`.

### 4.7 Debug output for the next iteration (R9)

Where a root cause could not be pinned from the existing logs, the diagnosis was made observable
rather than guessed:

- Codex post-run diagnostics moved to `src/codex.run-diagnostics.lib.mjs`, which makes the
  "is this a real warning?" decision a unit-testable function instead of an inline `if`. A failed
  codex run legitimately writes no `--output-last-message` file and emits no `turn.completed` usage;
  both used to be logged as `WARNING`, so one upstream failure produced two extra warnings pointing
  at nothing.
- The Formal AI runtime logs, at info level, the endpoint, protocol, config mechanism and the exact
  set of environment variables it injects — the `🧠 Formal AI:` lines visible throughout
  [`data/runs/e2e-final-summary.log`](data/runs/e2e-final-summary.log). That is what makes §5's
  per-tool table checkable at a glance.

---

## 5. Making `--model formal-ai` actually work for every tool (R3, R4)

### 5.1 The design decision

`formal-ai with <tool>` cannot be fixed from Hive Mind. What _can_ be done is to stop using it as an
argv wrapper and use Formal AI the way any other model provider is used: as an HTTP endpoint.

`src/formal-ai-runtime.lib.mjs` does this:

1. Start `formal-ai serve --agent-mode` with the repository clone as its `cwd`.
2. Run `HOME=<isolated> formal-ai with --global --no-start-server --base-url <url> <tool>` once, to
   let Formal AI itself materialise the per-client configuration it wants.
3. Translate that configuration into environment variables (or a config path) for the tool.
4. Invoke the **native** CLI, unchanged, with those variables.

`--dry-run` and `--only-prepare-command` never start a server and never write config.

### 5.2 Per-tool configuration channel

Captured live against formal-ai 0.317.0 —
[`data/runs/e2e-final-summary.log`](data/runs/e2e-final-summary.log):

| Tool     | Protocol  | Config channel                                                  | Environment injected                                                                                                                                         |
| -------- | --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| claude   | anthropic | `.profile` shell env                                            | `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `FORMAL_AI_API_KEY`                                                                                            |
| agent    | openai    | `XDG_CONFIG_HOME`, seeded from `~/.config/link-assistant-agent` | `FORMAL_AI_API_KEY`, `XDG_CONFIG_HOME`                                                                                                                       |
| codex    | openai    | `CODEX_HOME`, seeded from `~/.codex`                            | `CODEX_HOME`, `FORMAL_AI_API_KEY`                                                                                                                            |
| qwen     | openai    | `.profile` shell env + `OPENAI_MODEL`                           | `FORMAL_AI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`                                                                                     |
| gemini   | gemini    | `GEMINI_CLI_SYSTEM_SETTINGS_PATH`                               | `FORMAL_AI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, `GEMINI_CLI_TRUST_WORKSPACE`, `GEMINI_DEFAULT_AUTH_TYPE`, `GOOGLE_GEMINI_BASE_URL` |
| opencode | openai    | `XDG_CONFIG_HOME`, seeded from `~/.config/opencode`             | `FORMAL_AI_API_KEY`, `XDG_CONFIG_HOME`                                                                                                                       |

All six exit 0 against a live Formal AI server. Note the issue names five tools (claude, codex,
agent, gemini, qwen); opencode is included because it shares the runtime and would otherwise be the
one tool left on the old path.

### 5.3 Three sub-problems that only appear headless

- **codex `-c` after `exec`.** Configuration moved out of `-c` overrides into `CODEX_HOME`, seeded
  from the repository-scoped `CODEX_HOME` built by the capability preflight (issue #2074), so both
  features coexist.
- **`sh -lc` and stale `.profile` exports.** codex and qwen run through a login shell, which sources
  the operator's `~/.profile` — which may still hold exports from an earlier
  `formal-ai with --global` run. The run's environment is re-exported inside the script so it wins.
- **gemini headless auth.** Gemini CLI resolves `security.auth.selectedType` from the settings
  hierarchy and aborts with `Invalid auth method selected.` when it is unset;
  `GEMINI_DEFAULT_AUTH_TYPE` is interactive-only. Hive Mind supplies the missing setting through
  `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, so `HOME` — and with it the operator's git/gh/ssh
  configuration — stays untouched.
- **qwen headless auth.** `getAuthTypeFromEnv` in qwen-code 0.21.2 only returns the OpenAI auth type
  when `OPENAI_API_KEY`, `OPENAI_BASE_URL` **and** one of `OPENAI_MODEL` / `QWEN_MODEL` are all set.
  The `.profile` block `formal-ai with --global` writes contains only the first two, so every
  headless run aborted with _"No auth type is selected."_ `buildQwenAuthEnv` completes the triple,
  and only when the operator has not already set one.

### 5.4 What "works" means here — and what it does not

With the direct-endpoint runtime, all six CLIs reach Formal AI, stream tool calls, and exit 0. That
satisfies R3 and R4 on the Hive Mind side: the plumbing is no longer the thing that fails.

It does **not** yet produce a correct hello world, and the reason is now visible instead of hidden.
In every one of the six final runs, `hello.txt=MISSING`
([`data/runs/e2e-final-summary.log`](data/runs/e2e-final-summary.log)). §6 is what happens with
that.

---

## 6. Upstream defects, with reproductions (R2, R5)

These are defects in Formal AI 0.317.0 and, for one item, in codex-cli. Each has a stored
reproduction. The wrapper defects of §3 are the highest-severity group; the reasoning defects below
are what remains once the wrapper is bypassed.

### 6.1 Formal AI answers "no synthesis route" unless the prompt names a language

`data/probes/formal-ai-0.317.0-language-extraction.md` records the model's own words for seven
prompts against the same server. The pattern is unambiguous:

| Prompt                                                                 | Result                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Create a file named hello.txt … Then stop.`                           | `no synthesis route reaches task "hello_world" in language "the"` |
| `Create a file named hello.txt containing Hello World.`                | `… in language "missing"`                                         |
| `print hello world`                                                    | `… in language "missing"`                                         |
| `Write a hello world program in Python.`                               | ✅ correct program, with check/run commands and output            |
| `Create a file named hello.txt containing Hello World, in JavaScript.` | ✅ correct program                                                |

The router extracts a "language" token from the prompt by position rather than by meaning: in the
first prompt it picked the article **`the`** as the language name. When no candidate is found it
substitutes the literal string `missing` and then reports that it has no idiom for a language called
`missing`. This is the direct cause of R5 not being met: the model _can_ reason its way to a hello
world (rows 4–5 prove it), and refuses to when the language is implicit.

Suggested fix, in the issue to file: treat an unresolved language as "infer from context or ask",
not as a language named `missing`; and exclude stop-words from the language-candidate scan. A
workaround usable today is to append the target language to the prompt.

### 6.2 Formal AI takes the literal text after "containing" as the file content

`direct-gemini3.log` and `direct-qwen.log` both show the prompt
_"Create a file hello.txt containing exactly: Hello World"_ producing a `write_file` call whose
content is:

```text
exactly: Hello World
```

— [`data/runs/direct-gemini3.log`](data/runs/direct-gemini3.log)

The extractor slices the prompt after the keyword rather than parsing it. The word `exactly:` — an
instruction _about_ the content — became part of the content.

### 6.3 Formal AI absolutizes paths against a stale directory

In [`data/runs/direct-qwen.log`](data/runs/direct-qwen.log) the run's workspace is `…/ws-qwen`, but
every `file_path` Formal AI emits points at `…/ws2/` — a directory from an earlier probe. All three
tool calls therefore failed. The server is absolutizing tool paths against its own remembered cwd
instead of the client's, so any client whose cwd differs from the server's gets unusable paths.
Reproduction: start `formal-ai serve --agent-mode` in directory A, drive it from a client in
directory B, and observe the emitted `file_path`.

### 6.4 Formal AI reports success for a turn in which every tool call failed

Same log, same run. The three tool results were:

```text
is_error: true  File …/ws2/.formal-ai/general-change-plan.lino has not been read in this session
is_error: true  File …/ws2/hello.txt has not been read in this session
is_error: true  Command: cat hello.txt … Output: cat: hello.txt: No such file or directory … Exit Code: 1
```

and Formal AI's final message was:

> Completed the general change request for hello.txt and **verified it** with `cat hello.txt`.

This is the most serious of the reasoning defects, because it is a false claim of verification —
the opposite of the "nothing was guessed" guarantee the model states in §6.1's refusals. A model
that refuses to emit an underived program should equally refuse to report an unobserved success.

### 6.5 Other reproductions held for the upstream reports

- `formal-ai with <tool>` swallowing stdin, stealing `--model`/`--verbose`/`--silent`/`--base-url`/
  `--interactive`/`--non-interactive`/`--summarize`, appending caller args after its own
  `--print`/`-p`/`exec`, and entering orchestration mode on a case-insensitive keyword scan that
  `--disallowedTools … CronCreate …` always trips (§3).
- `write_stdin failed: Unknown process id 0` observed in the round-2 agent logs.
- A false-failure report on a shell command that had in fact succeeded.
- codex-cli: `-c` flags after `exec` replace, rather than extend, the global `-c` set (§5.3). Worth
  reporting to `openai/codex` as a documentation or behaviour issue, since it silently redirects
  traffic to the default provider.

---

## 7. Existing components and libraries considered (R8)

| Problem                                                   | Considered                                                                                                 | Decision                                                                                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Suppressing mirrored child-process output                 | command-stream's own `{ mirror, capture }` options; `execa`'s `stdio: 'pipe'`; Node `child_process`        | Used command-stream's options-call form. It is already the repo-wide execution layer; introducing a second one for probes would double the escaping rules and defeat `eslint-rules/no-direct-gh-exec`. |
| Keeping the "quiet" idiom composable with retries         | Wrapping at each call site vs. teaching the wrapper                                                        | Taught `wrapDollarWithGhRetry` to forward the options call. All 24 modules build `$` through it, so one change covers every site.                                                                      |
| Tolerating injected `$` doubles                           | Auto-allowlisting inside `wrapDollarWithGhRetry`; a type guard at every site                               | `quietProbe()` with a `WeakMap`, because `tests/github-rate-limit.test.mjs:355-410` passes plain arrow-function tags that are not option-callable.                                                     |
| Masking secrets before publication                        | `src/token-sanitization.lib.mjs` (already exists, issue #1745)                                             | Reused. §4.6 removes the one call whose output is unmaskable _by construction_ — the token-discovery call itself.                                                                                      |
| Driving a local OpenAI-compatible endpoint                | `formal-ai with`; LiteLLM-style proxy; direct env-var injection                                            | Direct env-var injection. Every CLI already supports `*_BASE_URL` + API key, so no proxy layer is needed and the native argv stays under Hive Mind's control.                                          |
| Isolating per-run config without touching operator `HOME` | `HOME=` override; `XDG_CONFIG_HOME`; tool-specific roots (`CODEX_HOME`, `GEMINI_CLI_SYSTEM_SETTINGS_PATH`) | Tool-specific roots wherever one exists, so the operator's git/gh/ssh configuration is never shadowed. `HOME` is overridden only for the throwaway config-materialisation step.                        |
| Terminal-state detection in watch loops                   | `src/github-terminal-state.lib.mjs` (issue #1931)                                                          | Reused unchanged; only its default command runner was made quiet.                                                                                                                                      |

---

## 8. Solution plan status

| Requirement | Plan                                                                                                        | Where                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| R1          | Fix each false positive/negative/warning/error evidenced in the stored logs; add regression tests           | §4; `tests/test-issue-2130-log-noise.mjs`, `tests/test-issue-2130-formal-ai-runtime.mjs` |
| R2          | File upstream issues with the reproductions in §6                                                           | §6                                                                                       |
| R3, R4      | Direct-endpoint runtime for all six CLIs                                                                    | §5; `src/formal-ai-runtime.lib.mjs`                                                      |
| R5          | Upstream — the router and the verification claim                                                            | §6.1, §6.4                                                                               |
| R6, R7      | This folder and this file                                                                                   | [`data/`](data/)                                                                         |
| R8          | Component survey                                                                                            | §7                                                                                       |
| R9          | Codex run diagnostics extracted and unit-tested; Formal AI runtime logs endpoint/protocol/config/env        | §4.7                                                                                     |
| R10         | Quiet-probe idiom applied across all 20 affected modules, with a repo-wide static test guarding regressions | §4.6                                                                                     |
