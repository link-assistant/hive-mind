# agent-commander

## 0.11.0

### Minor Changes

- e18b4c6: Sync the six tool catalogues with Hive Mind, preserve Claude's rolling Opus execution alias, and correct native resume for Gemini, OpenCode and Agent, and add controller cancellation. Fix native usage totals, cached Codex input accounting, stdout-only protocol parsing, incomplete-turn detection, scoped subagent metadata, shell quoting, and UTF-8 streaming. Cached input is now reported separately from fresh Codex input in `cacheReadTokens`.

## 0.10.1

### Patch Changes

- f1238e7: Remove the obsolete development-only patch lifecycle from published packages so clean consumer installs succeed, and require the released command-stream renderer fixes.

## 0.10.0

### Minor Changes

- d44d5e6: Expose terminal artifact rendering and format options, default agent captures
  to publishable 4:3 geometry, and include GIF replay fallbacks.

## 0.9.1

### Patch Changes

- b19e3f9: Add pre-prompt TUI interactions for first-run and workspace-trust dialogs, and
  default interactive launches to `TERM=xterm-256color` while preserving explicit
  caller overrides.

## 0.9.0

### Minor Changes

- c9623a8: Add cross-client real-TUI launch, input and resize control, semantic transcript
  normalization, and terminal artifact capture backed by command-stream.

## 0.8.0

### Minor Changes

- 5dbc0a3: Add a uniform per-command approval relay ("ask" mode). The new `--approve-each` flag (alias `--permission-mode ask`, library `approveEach`) maps to each backend's native per-command approval mechanism and relays native permission prompts to the consumer as normalized `permission_request` NDJSON events (carrying an opaque `id`, `tool`, `command`/`pattern`, `title`, and a `scope`), forwarding the consumer's normalized decision (`once` | `always` | `reject`) back to the native CLI in its own wire format. Supported (relayable) for `agent` (`--permission-mode ask` + `--input-format stream-json`, scope `session`) and `claude` (stream-json `can_use_tool`, scope `tool-input`); rejected with a clear error for `codex`, `qwen`, `gemini`, and `opencode`, which have no drivable JSON handshake. Exposes a `permissions` module (`normalizePermissionRequest`, `buildPermissionResponse`, `PermissionRelay`, `PERMISSION_PARITY`, `supportsAsk`, `ASK_DECISIONS`, `ASK_SCOPE`).

## 0.7.0

### Minor Changes

- de0cfbf: Map `--read-only` and `--plan-only` for the `agent` tool to its native `--permission-mode` (agent v0.24.0): `--read-only` → `readonly` and `--plan-only` → `plan`. The `agent` tool now supports enforceable read-only/planning mode instead of being rejected, and exposes typed `permissionMode` and `permission` (OpenCode-compatible JSON policy) passthrough options.

## 0.6.2

### Patch Changes

- 118fb3f: Fix `metadata.success=false` / `metadata.limitReached=true` false positives on successful Claude runs. The usage-limit detector no longer matches the bare `ratelimit` substring inside Anthropic HTTP header names (e.g. `anthropic-ratelimit-unified-5h-reset`) emitted in `--output-format stream-json`, and now trusts an explicit structured `result` success message over the raw-text scan.

## 0.6.1

### Patch Changes

- ac30054: Add Qwen and Gemini prompt-file stdin handling plus native executable, environment, and raw argument passthrough parity.

## 0.6.0

### Minor Changes

- f3c9ebc: Expose native execution passthrough controls for Claude, Codex, OpenCode, and @link-assistant/agent, including custom executables, raw tool environment variables, raw tool arguments, and suppressible default safety bypass flags.

## 0.5.0

### Minor Changes

- 80f26b4: Expose normalized `metadata` on agent results with success classification, session IDs, usage-limit details, summaries, cost estimates, token usage, sub-agent calls, and execution error information for `claude`, `codex`, `opencode`, and `agent`.

## 0.4.3

### Patch Changes

- f914440: ### Fixed
  - Pipe prompts for stdin-based tools through temporary prompt files during execution so large generated prompts are not embedded in nested shell commands.

  ### Added
  - Added `--prompt-file` / `promptFile` support for callers that already have prompt content on disk.

## 0.4.2

### Patch Changes

- 5ca235f: Add JavaScript package README metadata, language-specific GitHub Release tags, and cross-language release documentation.

## 0.4.1

### Patch Changes

- a310e7d: Expose a repository-root npm package manifest for GitHub dependency installs and align JavaScript release publishing with the dedicated js.yml workflow.

## 0.4.0

### Minor Changes

- 6d5f7fe: Sync model maps from hive-mind v1.57.2 (issue #22):
  - Claude: `opus` now resolves to `claude-opus-4-7` (was `claude-opus-4-6`); add `opus-4-7` and `claude-opus-4-7` aliases. `opus-4-6` retained for backward compatibility.
  - Codex: add `gpt-5.5` family (and `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1-codex-max`); default model changed from `gpt-5` to `gpt-5.5`.
  - Agent: add `nemotron-3-super-free` (NVIDIA hybrid Mamba-Transformer); default model changed from `minimax-m2.5-free` to `nemotron-3-super-free`; mark `qwen3.6-plus-free` as deprecated (kept for backward compatibility).

## 0.3.0

### Minor Changes

- 921bcd6: Add enforceable read-only planning mode for supported tools and reject unsupported tools.

## 0.2.0

### Minor Changes

- cca4668: Add Qwen Code CLI support
  - Added new `qwen` tool configuration for Qwen Code CLI (Alibaba's AI coding agent)
  - Supports stream-json output format for real-time NDJSON streaming
  - Supports auto-approval mode with `--yolo` flag (enabled by default)
  - Supports session management with `--resume` and `--continue` options
  - Supports context options like `--all-files` and `--include-directories`
  - Supports `--include-partial-messages` for real-time UI updates
  - Added model aliases: `qwen3-coder`, `coder`, `gpt-4o`
  - Added comprehensive tests for the new Qwen tool
