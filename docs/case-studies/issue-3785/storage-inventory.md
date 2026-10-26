# Native storage inventory

Investigated on 2026-10-26. This is an initial source inventory for the open
canonical-storage requirements, not a verified mount manifest. No provider
credentials were read or changed to produce it. Paths must be confirmed with
real CLI writes, discovery and resume tests before production routing changes.

| CLI inspected   | Auth authority found                                                                                                                       | Conversation/runtime storage found                                                                                                                           | Config separation and unresolved questions                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude 2.1.310  | Linux `.credentials.json` below the independently selected `CLAUDE_SECURESTORAGE_CONFIG_DIR`, otherwise `CLAUDE_CONFIG_DIR` or `~/.claude` | The same configuration root contains session history; `projects/` includes transcripts and auto memory                                                       | `CLAUDE_CONFIG_DIR` moves settings, plugins and history together. Independent secure-storage status/logout pass a native Linux probe; login, refresh and complete history still need verification.     |
| Codex 0.164.0   | File auth is `CODEX_HOME/auth.json`; other selected credential-store modes need their own identity checks                                  | Sessions, archived sessions, history and SQLite state; `sqlite_home`/`CODEX_SQLITE_HOME` can redirect the database independently                             | `CODEX_HOME` also holds configuration and plugin state. Moving only sessions misses other state. File storage and refresh coordination fail the retained probes.                                       |
| Gemini 0.65.0   | `oauth_creds.json` in the global Gemini directory, normally `~/.gemini`; `GEMINI_CLI_HOME` changes the parent home                         | Runtime root includes `projects.json`, project history and `tmp/<project-id>` chats, checkpoints and recovery-related state                                  | On Linux the runtime root normally equals the global config root. The macOS sandbox special case is not a general runtime-root switch. Managed/system paths and all refresh writers remain unverified. |
| Qwen 0.26.1     | `QWEN_HOME/oauth_creds.json`, default `~/.qwen/oauth_creds.json`; MCP credentials have a separate file                                     | `QWEN_RUNTIME_DIR` or configured runtime context holds `projects/<project-id>` chats/status and hashed temporary checkpoints, tool results and shell history | A separate runtime root is supported. Auth still shares the global root with settings, commands, memory and extensions. Runtime-context precedence and provider refresh locking need actual CLI tests. |
| agent 0.27.0    | XDG data root `link-assistant-agent/auth.json`; additional provider credential integrations must be inventoried                            | `link-assistant-agent/storage` under the XDG data root contains project/session/message/part records                                                         | XDG config, data, cache and state roots are distinct. Sharing the data root alone has not established every history surface or all provider refresh coordination.                                      |
| OpenCode 1.19.4 | XDG data root `opencode/auth.json`; `OPENCODE_AUTH_CONTENT` can substitute an environment snapshot                                         | SQLite `opencode.db` under the data root by default; `OPENCODE_DB` can select another path; SQLite uses WAL                                                  | XDG config/data/state are distinct and config has an override. Database sidecars, repositories/snapshots and plugin-specific OAuth implementations must be included in lifecycle tests.                |

## Source references and boundaries

### Claude

Anthropic's [authentication reference](https://code.claude.com/docs/en/authentication)
describes platform credential storage and authentication precedence. Its
[environment reference](https://code.claude.com/docs/en/env-vars) describes
`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PROJECT_DIR_NAME`, managed/user overrides and
settings changes applied to running sessions. The
[settings reference](https://code.claude.com/docs/en/settings) also identifies
`~/.claude.json` as account/project/runtime configuration; a clean-home policy
cannot inspect `settings.json` alone.

A disposable Linux probe of the pinned binary confirms that
`CLAUDE_SECURESTORAGE_CONFIG_DIR` separates credentials from configuration.
An explicitly empty value pins `HOME/.claude` despite a different config root;
the selector is NFC-normalized. Native `auth status --json` and `auth logout`
use the selected store without changing the synthetic credentials in the
private configuration root. This interface is described in an
[upstream documentation issue](https://github.com/anthropics/claude-code/issues/79223).
The `/limits` reader now follows the same precedence. This does not yet replace
the legacy production credential file mount or verify login/refresh/history.

Claude already documents a shared refresh lock in its
[refresh-contention diagnostic](https://code.claude.com/docs/en/errors#could-not-refresh-your-login-because-another-claude-code-process-is-refreshing-it).
That is evidence against generalizing the Codex race to every CLI. It does not
verify lock identity, stale-owner handling or logout/login across different PID
and mount namespaces. No real Claude refresh probe has been run here. The docs
are current references, not a source-level attestation of every installed byte.

### Codex

The versioned [configuration implementation](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/config/mod.rs)
defines the home and SQLite overrides. The
[file auth storage](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/login/src/auth/storage.rs)
and [refresh manager](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/login/src/auth/manager.rs)
establish the file path and process-local guard described in the case study.
Two actual CLI processes sharing a directory reproduce a concurrent exchange
of the same synthetic predecessor. The command-helper and app-server hooks
described in [the case study](README.md#codex-and-concurrent-refresh) are possible
adapter inputs. Actual app-server callbacks observe an externally committed
replacement on the next model request without creating native `auth.json`.
The retained two-container experiment makes two callbacks overlap: an adapter
worker in each container takes the same host-backed `flock`, rereads the stored
generation, and exchanges the synthetic predecessor once. Removing the lock
reproduces two exchanges and predecessor rejection. A separate owner-death check
verifies that removing the owning container releases the same lock inode.
The schema labels this interface internal and unstable; this experimental
adapter is not integrated with production execution or opaque host writers.
Login/logout and full conversation storage remain unverified through this path.

### Gemini and Qwen

Gemini's versioned [storage implementation](https://github.com/google-gemini/gemini-cli/blob/v0.65.0/packages/core/src/config/storage.ts)
includes project registration, migration and separate history/temp trees; its
[path helper](https://github.com/google-gemini/gemini-cli/blob/v0.65.0/packages/core/src/utils/paths.ts)
resolves `GEMINI_CLI_HOME`. Qwen's versioned
[storage implementation](https://github.com/QwenLM/qwen-code/blob/v0.26.1/packages/core/src/config/storage.ts)
defines its independent runtime root, pinned runtime-context precedence and
project status sidecars. The similar default directory layouts do not imply
identical override semantics. Neither source inventory is a refresh-lock audit.

A subsequent bounded experiment exercises the actual installed Qwen 0.26.1
`SharedTokenManager` export with mocked OAuth in three separate processes.
An owner pauses inside its refresh. A second process constructs a manager and
exits without acquiring the lock. Its native exit handler unlinks the live
owner's lock, allowing a third process to exchange the same synthetic G0 before
the owner completes. A control observer that does not construct the manager
leaves the lock intact; the peer rereads committed G1 without another exchange.
See `probe-qwen-lock-ownership.mjs` and
[structural evidence](evidence/qwen-lock-ownership.txt).
The [versioned cleanup implementation](https://github.com/QwenLM/qwen-code/blob/v0.26.1/packages/core/src/qwen/sharedTokenManager.ts#L178-L199)
unconditionally unlinks the path, without recording lock ownership. The same
code is present in inspected main commit `2a6f777edfd3fc805b1761f4eff971458225d7a5`.
This establishes a native class defect; it is not a full CLI/provider,
cross-container or production-coordinator verification.

### agent

The npm metadata for installed 0.27.0 identifies commit
`cb89099a069e9bf0582e16efa1c44543953f3951`. Its
[global paths](https://github.com/link-assistant/agent/blob/cb89099a069e9bf0582e16efa1c44543953f3951/js/src/global/index.ts)
match the installed source (SHA-256
`85f484489e59aca10c21ca8307e065e048f22eec832bbb202386777a4d354d49`).
The [auth module](https://github.com/link-assistant/agent/blob/cb89099a069e9bf0582e16efa1c44543953f3951/js/src/auth/index.ts)
reads and rewrites the JSON store. The
[storage module](https://github.com/link-assistant/agent/blob/cb89099a069e9bf0582e16efa1c44543953f3951/js/src/storage/storage.ts)
uses a process-local lock utility. That observation does not establish the
coordination behavior of every OAuth plugin or alternate credential source.

### OpenCode

The pinned [global paths](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/core/src/global.ts)
separate config/data/state and initialize a filesystem-lock facility. Its
[auth module](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/opencode/src/auth/index.ts)
supports the environment snapshot and JSON store. Its
[database module](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/core/src/database/database.ts)
defines database-path selection and WAL mode. The existence of a filesystem
lock facility does not prove provider refresh uses it. Current V2 migration
documentation must not be substituted for this installed V1 layout.

## What this inventory does not establish

No row certifies safe canonical storage, full native discovery/resume or private
task configuration. A proposed adapter must account for each CLI's atomic write,
logout/login, override and migration behavior, then pass root plus two-task
tests in the actual packaged image. Cross-container lock tests must also cover
stale owners and fresh generation reads. All native host writers must participate;
a launcher-only lock does not coordinate an opaque CLI's internal exchange.

The original authentication-copy implementation is still present. The inventory
does not justify replacing it with file links, file mounts, snapshots, or an
untested whole-home share. See [the acceptance inventory](requirements.md) for
the open implementation and release/deployment requirements.
