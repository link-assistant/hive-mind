# Case study: issue #4077 — `CLAUDE execution failed with } ReadableStream { … }`

- Issue: https://github.com/link-assistant/hive-mind/issues/4077
- Pull request: https://github.com/link-assistant/hive-mind/pull/4078
- Failing run: https://github.com/link-assistant/formal-ai/pull/1581 (`fix … --ci-cd --think high --attach-logs --verbose`)
- Raw data: [`raw/`](./raw)
  - [`log-tQRDXo.txt`](./raw/log-tQRDXo.txt): the full `solve` log (sanitized, 124,699 lines), from the issue's first gist
  - [`log-18P37G.txt`](./raw/log-18P37G.txt): the `start-command` log of the same task (124,788 lines), from the second gist
  - [`comment-6909568186.md`](./raw/comment-6909568186.md): the "Solution Draft Failed" comment that published the message
  - [`comment-6909598996.md`](./raw/comment-6909598996.md): the "Container OOM event" notice for the same session
  - [`issue-4077.json`](./raw/issue-4077.json), [`issue-4077-comments.json`](./raw/issue-4077-comments.json), [`pr-4078-comments.json`](./raw/pr-4078-comments.json), [`pr-4078-review-comments.json`](./raw/pr-4078-review-comments.json)
- Upstream report draft: [`upstream-anthropic-sdk-typescript.md`](./upstream-anthropic-sdk-typescript.md)
- Experiments: [`experiments/issue-4077/`](../../../experiments/issue-4077)
- Regression test: [`tests/issue-4077-sdk-debug-fragment-error.test.mjs`](../../../tests/issue-4077-sdk-debug-fragment-error.test.mjs), with a fixture copied from the failing run: [`tests/fixtures/issue-4077/claude-stdout-sdk-debug-cycle.txt`](../../../tests/fixtures/issue-4077/claude-stdout-sdk-debug-cycle.txt)

## 1. What happened

The work session on formal-ai PR #1581 ended with this comment:

```text
## 🚨 Solution Draft Failed
The automated solution draft encountered an error:
CLAUDE execution failed with } ReadableStream { locked: false, state: 'readable', supportsBYOB: false }
```

`} ReadableStream { … }` is not an error. It is the last line of a debug dump that the Anthropic SDK inside Claude Code printed to stdout. The real cause was that the Claude Code process was killed by SIGKILL (exit code 137) in a container that had hit its memory limit. The message gave the reader no hint of that.

### Timeline (UTC, 2026-11-16)

| When          | Event (log line)                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 05:53:09      | `start-command` starts the task (execution `58df60e3-…`), `log-18P37G.txt:3`                                                                                                                                 |
| 05:54:27      | `solve` starts; container memory 512 MB of a 2.9 GB cgroup limit (`log-tQRDXo.txt:16`)                                                                                                                       |
| 05:56:32      | Before Claude starts: 2.7 GB used of 2.9 GB, peak 2.9 GB (`:242`)                                                                                                                                            |
| 05:57:05      | Claude Code 2.1.325 starts (`"claude_code_version": "2.1.325"`, `:868`) with `ANTHROPIC_LOG=debug` because of `--verbose`. Its bundled SDK reports `x-stainless-package-version: 0.128.0` (`:1020`)          |
| 05:57:06.103  | First `response 200 https://api.anthropic.com/v1/messages?beta=true Headers {` line on stdout (`:1062`), ending at `:1090` with `} ReadableStream { locked: false, state: 'readable', supportsBYOB: false }` |
| 05:57 – 06:46 | 413 such blocks are printed, one for each streamed API request                                                                                                                                               |
| 06:11:38      | The OOM killer kills a process in the task cgroup (the OOM notice comment). The agent later notes that its Rust build was OOM-killed (`:102359`)                                                             |
| 06:46:49      | Last tool call: "Run JS candidate validation twin test" (`:124591`)                                                                                                                                          |
| 06:46:55.259  | `[STDERR] Killed` (`:124597`): Claude Code is killed by SIGKILL                                                                                                                                              |
| 06:46:55.539  | `❌ Claude command failed with exit code 137` (`:124613`). Cross-checks for usage limit and access errors find nothing                                                                                       |
| 06:47:00      | `The kernel OOM killer has killed 7 process(es) in this container's cgroup; memory.events oom=7` (`:124650`)                                                                                                 |
| 06:47:02      | `💾 Critical error (CLAUDE execution failed with } ReadableStream { … })`: uncommitted work is preserved on `recovery/issue-1580-8d61a32a61e1` (`:124664`–`:124684`)                                         |
| later         | The "Solution Draft Failed" comment publishes the same text. The OOM notice is posted separately                                                                                                             |
| 12:30:54      | Issue #4077 is filed                                                                                                                                                                                         |

## 2. Requirements from the issue

| #   | Requirement                                                                              | Where it is addressed                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Find the root cause                                                                      | §3; reproduced in `experiments/issue-4077/replay-stdout-capture.mjs` and `sdk-stream-debug-log.mjs`                                           |
| R2  | Fix all similar issues: source code / dumps leaking into error messages                  | §4.2: a shared guard at the publishing boundary for every tool, not only Claude                                                               |
| R3  | Narrow check for similar open issues, fix them in this PR                                | §6                                                                                                                                            |
| R4  | Download all logs and data to `docs/case-studies/issue-4077`                             | `raw/`                                                                                                                                        |
| R5  | Deep case study: timeline, requirements, root causes, solutions, libraries, online facts | this document                                                                                                                                 |
| R6  | Add debug output / verbose mode if data is not enough                                    | §5: the existing data was enough. The existing `--verbose` (`ANTHROPIC_LOG=debug`) and the usage-limit cross-check already logged every input |
| R7  | Report issues to other projects, with a reproducible example, workaround and code fix    | §7: `upstream-anthropic-sdk-typescript.md`, filed on `anthropics/anthropic-sdk-typescript`                                                    |
| R8  | Apply the fix to the whole codebase                                                      | §4: both stdout capture sites in `src/claude.lib.mjs`, the shared `isMeaningfulErrorText` used by every tool adapter                          |

## 3. Root causes

### 3.1 The SDK prints one debug line without its `[log_<id>]` prefix (upstream)

With `--verbose`, hive-mind starts Claude Code with `ANTHROPIC_LOG=debug` (`src/claude.lib.mjs:401`). This lets `claude.usage-limit-sources.lib.mjs` read the `anthropic-ratelimit-unified-*` headers of a 429 response (issue #3570). The SDK debug logger writes to stdout through `console`, which is also where Claude Code prints its `stream-json` output (see anthropics/claude-agent-sdk-typescript#157).

Every SDK debug line starts with the request log ID: `[log_345fb5] sending request {`, `[log_345fb5] response start {`, `[log_345fb5, request-id: "req_…"] post … succeeded with status 200 in 612ms`, `[log_345fb5] response parsed {`. The exception is in `src/internal/parse.ts` line 24 of `@anthropic-ai/sdk`. It is the same in 0.128.0 (the version bundled by Claude Code 2.1.325) and in the latest release, 1.8.0:

```ts
if (props.options.stream) {
  loggerFor(client).debug('response', response.status, response.url, response.headers, response.body);
```

The raw `Headers` and `ReadableStream` objects go to `console.debug`. Node prints them on one line:

```text
response 200  Headers { 'content-type': 'text/event-stream', 'request-id': 'req_example' } ReadableStream { locked: false, state: 'readable', supportsBYOB: true }
```

The Claude Code runtime prints the headers as a multi-line block with double-quoted keys, and the block ends with the line from the issue (fixture lines; IDs replaced):

```text
response 200 https://api.anthropic.com/v1/messages?beta=true Headers {
  "date": "…",
  "content-type": "text/event-stream; charset=utf-8",
  …
  "cf-ray": "EXAMPLE-FRA",
} ReadableStream { locked: false, state: 'readable', supportsBYOB: false }
```

The line duplicates the prefixed `[log_<id>] response start` block that `client.ts` logs just before it, with redacted headers. It adds no information.

### 3.2 hive-mind did not recognise that block as debug output

`src/claude.lib.mjs` keeps the last non-JSON stdout line as `lastMessage`. On a non-zero exit, that line becomes the failure reason through `buildToolErrorMessage()`. Lines are skipped only when `createClaudeUsageLimitEvidence().observeRawLine(line).isDebugOutput` is true. Before this PR, that detector:

- opened a debug block only for lines matching `^\[log_[0-9a-f]+\]\s`, so it missed the unprefixed `response 200 … Headers {` and the `[log_x, request-id: …] post … succeeded` summary, whose prefix has a comma;
- closed a block only on a line that was exactly `}`, while this block ends with `} ReadableStream {…}`.

As a result, 30 lines of each request cycle (the `response 200` header lines, its closing `} ReadableStream {…}` line and the `post … succeeded` summary) were captured as `lastMessage`, each overwriting the previous one. The replay [`replay-before-fix.txt`](../../../experiments/issue-4077/replay-before-fix.txt) shows it on the real fixture: `lines captured as lastMessage: 30`, then `published: CLAUDE execution failed with } ReadableStream { … }`.

### 3.3 Nothing at the publishing boundary rejected source-like text

Earlier guards in `isMeaningfulErrorText()` (`src/lib.mjs`) reject blank text and lone punctuation (#1941), `[object Object]`-style placeholders (#2141), and long base64/opaque bodies (#3759). A line that starts with `}` contains letters, so it passed. The issue notes that source code has leaked into error messages "multiple times". Every such leak was the tail of a printed object or code block. The tool adapters for codex, agent, opencode, gemini and qwen all go through the same `formatToolExecutionFailure()` / `extractToolErrorCore()` path, so the gap was not limited to Claude.

### 3.4 The fallback hid the signal

Even without the leak, the fallback said only `Claude command failed with exit code 137`. Exit code 137 is 128 + 9 (SIGKILL), but the message did not say so. `describeExitCode()` already existed in `src/claude.process-exit.lib.mjs` and was not used there.

### 3.5 The underlying kill: container memory

The SIGKILL itself came from the container's 2.9 GB cgroup limit (7 OOM kills by the end, `State.OOMKilled = true`). Memory was already at 2.7 GB before Claude started. The agent was running `cargo check` and `node --test` inside the same cgroup. Exit code 137 alone does not prove an OOM kill (`solve.tool-kill-resume.lib.mjs`), so the failure message names the signal and leaves the cause to the separate OOM notice, which already reported it correctly. Container memory sizing and automatic OOM recovery are tracked in #2803. This PR does not change them.

## 4. Solution

### 4.1 Recognise the SDK debug output (`src/claude.usage-limit-sources.lib.mjs`, `src/error-text.lib.mjs`)

- `SDK_STREAM_RESPONSE_DEBUG_LINE = /^response \d{3}\s.*\bHeaders\s*\{/` marks the unprefixed stream response line as debug output. It opens a skip block only when the line ends with `{` (multi-line form). The one-line Node form does not open a block.
- `SDK_DEBUG_LOGGER_LINE = /^\[log_[0-9a-f]+(?:,[^\]]*)?\]\s/i` also accepts `[log_x, request-id: "…"]` summaries.
- A block now ends at any line that starts with `}`, which includes `} ReadableStream {…}`.

The 429 header classification (issue #3570) is unchanged. Its tests still pass.

### 4.2 Reject source and debug fragments at the boundary (`isSourceFragmentErrorText`)

A new shared predicate in `src/error-text.lib.mjs` checks the first non-empty line of a candidate error text. It returns true when the line:

- starts with a closing bracket (`}`, `]`, `)`): the tail of an inspected object or a code block (`} ReadableStream {…}`, `}, {`, `]);`, `} catch (error) {`, `} from '…'`);
- is the SDK stream-response line or starts with an SDK `[log_<id>…]` prefix;
- is a quoted object key, such as `"content-type": "text/event-stream",`;
- is an inspected property with a function or nested placeholder value, such as `toReadableStream: [Function: toReadableStream],` or `messages: [Array ...],`;
- is a stack frame (`at fn (file:///…:12:3)`).

It is used:

- in `isMeaningfulErrorText()` (`src/lib.mjs`). That function sits behind `buildToolErrorMessage()`, `extractToolErrorCore()` and `formatToolExecutionFailure()` for every tool, so a fragment can no longer be published, whichever adapter captured it;
- at both raw stdout capture sites in `src/claude.lib.mjs`, so a fragment does not overwrite an earlier real message.

Real reasons still pass. The test checks `API Error: 500 {"type":"error",…}`, `SyntaxError: Unexpected token {`, `Error: ENOSPC …`, usage-limit texts, non-Latin text and others.

### 4.3 Name the signal in the fallback (`src/claude.lib.mjs`)

The fallback and the error log line now use `describeExitCode(exitCode)`: `Claude command failed with exit code 137 (SIGKILL)`.

### 4.4 Result on the failing run

[`replay-after-fix.txt`](../../../experiments/issue-4077/replay-after-fix.txt) replays the 137-line fixture: no line is captured, and the published text is the exit-code fallback. With §4.3 the message is now:

```text
CLAUDE execution failed with Claude command failed with exit code 137 (SIGKILL)
```

### 4.5 Alternatives considered

| Option                                                                           | Why not chosen (alone)                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop setting `ANTHROPIC_LOG=debug` under `--verbose`                             | It is the only source of the 429 `anthropic-ratelimit-unified-*` headers used by the usage-limit cross-check (#3570), and it is useful debug data in attached logs                    |
| Give Claude Code a custom SDK logger that writes to stderr                       | Claude Code builds its own SDK client. hive-mind cannot pass a `logger`. This is the fix suggested upstream in anthropics/claude-agent-sdk-typescript#157                             |
| Only fix the debug-block detector                                                | It fixes this dump, but not the general class: the next unknown dump or code tail would leak again. The boundary guard covers every tool                                              |
| Only take error text from `stream-json` `result`/`error` events, never raw lines | Raw lines are the only source when Claude Code fails before or outside the JSON stream (e.g. `API Error: …` printed as text, issues #1941 and #3922), so this would lose real reasons |

### 4.6 Existing components and libraries

- `@anthropic-ai/sdk` logging: `ANTHROPIC_LOG` / `logLevel` and a `logger` option (any object with `debug/info/warn/error`, for example `pino`). Debug output goes through `console` unless a logger is given. Redaction of auth headers happens only in `debugLogRequestDetails`, not in the stream line above.
- Node's `util.inspect` decides the one-line vs. multi-line layout (`breakLength`, 80 columns by default). This is why the same call prints one line for small headers and a block for the real response headers.
- The hive-mind helpers reused here: `isMeaningfulErrorText` / `buildToolErrorMessage` (#1941), `extractToolErrorCore` / `formatToolExecutionFailure` (#1845), `isPlaceholderErrorText` (#2141), `isOpaqueErrorText` (#3759), `observeRawLine` (#3570), `describeExitCode`.

## 5. Was more debug output needed? (R6)

No. The verbose log already had everything needed to reconstruct the failure: every raw stdout line with timestamps, the `Killed` line on stderr, the usage-limit and access-error cross-checks, the container cgroup readings and OOM counters. No new logging was added. The fix only changes how existing output is classified.

## 6. Similar open issues (R3)

A narrow search of open issues for `execution failed with`, `ReadableStream`, `exit code 137`, `source code` / `leak` in error messages:

- #2803 "CLAUDE execution failed with Claude command failed with exit code 137": still open. It asks for OOM handling (automatic recovery, memory limits in `start-command`) and is waiting on `link-foundation/start`. This PR does not close it. It only makes that failure message name the signal (`137 (SIGKILL)`).
- The earlier leaks of this class are closed: #1941 (empty/punctuation reasons), #2141 (`[object Object]`), #3759 (opaque bodies with `[log_…]` summaries), #3570 (429 debug blocks), #3922 and #2687 (log and commit lines appended to `Final tool result failed`).
- Other open hits are about OOM handling or recovery, not about the published text: #3125, #3435, #3719, #3723, #2631, #3433, #3434, #3573, #4045, #4052.

No other open issue reports a source or dump fragment as a failure reason.

## 7. Upstream report (R7)

Filed as https://github.com/anthropics/anthropic-sdk-typescript/issues/1299, text in [`upstream-anthropic-sdk-typescript.md`](./upstream-anthropic-sdk-typescript.md):

- reproducible example: a fake `fetch` returning an SSE stream, run with `ANTHROPIC_LOG=debug` (the same as [`experiments/issue-4077/sdk-stream-debug-log.mjs`](../../../experiments/issue-4077/sdk-stream-debug-log.mjs); its output is in [`sdk-stream-debug-log.output.txt`](../../../experiments/issue-4077/sdk-stream-debug-log.output.txt));
- workaround: do not enable debug logging where output is parsed, filter `'response'` debug calls with a custom logger, or treat `/^response \d{3}\s.*\bHeaders\s*\{/` lines (and their block) as debug output, which is what this PR does;
- suggested fix: drop the duplicated call in `parse.ts`, or log it through `debugLogRequestDetails` with the `[${requestLogID}]` prefix.

The stdout-vs-stderr part is already reported as anthropics/claude-agent-sdk-typescript#157, so it was not filed again.

## 8. Verification

```bash
node --test tests/issue-4077-sdk-debug-fragment-error.test.mjs   # 11 tests
node experiments/issue-4077/replay-stdout-capture.mjs            # before/after on the real fixture
ANTHROPIC_LOG=debug node experiments/issue-4077/sdk-stream-debug-log.mjs <unpacked @anthropic-ai/sdk dir>
```

Existing tests for the touched helpers (issues #1845, #1941, #2141, #3570, #3759, #3922 and the Claude runner tests) pass. Five Claude-runner test files (`playwright-mcp-prompts`, `test-activity-timeout-1510`, `test-issue-1600-comprehensive`, `test-solution-summary`, `test-opusplan-support`) fail locally both with and without this change, so those failures predate it.

## 9. Online sources

- `@anthropic-ai/sdk` `src/internal/parse.ts` (line 24, 0.128.0 and 1.8.0): https://app.unpkg.com/@anthropic-ai/sdk@1.8.0/files/src/internal/parse.ts
- `ANTHROPIC_LOG=debug corrupts SDK protocol - debug logs should go to stderr`: https://github.com/anthropics/claude-agent-sdk-typescript/issues/157
- SDK logging options (`ANTHROPIC_LOG`, `logLevel`, `logger`) and `debugLogRequestDetails`: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/internal/utils/log.ts
- Exit status 128 + n for a fatal signal n (POSIX shell): https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_08_02
