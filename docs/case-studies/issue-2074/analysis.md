# Root-cause and solution analysis

## Root causes

### 1. Dependency provisioning happened at the wrong lifecycle boundary

`src/codex.lib.mjs` launched `codex exec` directly. An AI session cannot reliably provision the capabilities needed to govern that same session: its available tools and skills have already been constructed. The session's plugin-install request was therefore both too late and subject to a separate environment allowlist.

### 2. The two plugin identifiers describe different interfaces

The task named `superpowers@openai-curated-remote`, matching the environment plugin recommendation convention. Current Codex CLI catalog output identifies it as `superpowers@openai-curated`. Passing the former directly to `codex plugin add` cannot be assumed to work. Preflight normalizes this known transport suffix before catalog resolution; it still reports the original missing skill when no provider exists.

### 3. A new Codex home does not independently contain marketplace metadata

A fresh `CODEX_HOME` does not expose the operator's configured curated marketplace. Copying only `.tmp/plugins` also fails because Codex validates it against `.tmp/plugins.sha`. This explains why simply pointing a process at an empty per-repository home is insufficient. The implementation reuses the operator marketplace snapshot through a relative symlink and copies the matching SHA, while keeping plugin enablement in the scoped config.

### 4. Persistence and isolation pulled in opposite directions

Global installation persists but affects unrelated repositories. A temporary home isolates state but disappears. The durable path `$CODEX_HOME/hive-mind/repositories/<owner>/<repo>` provides both properties. Parent authentication and current runtime configuration are synchronized; scoped plugin blocks are retained across invocations.

### 5. Docker propagated Codex state but not standard user skills

The isolation runner already mounted `~/.codex`, so nested Docker tasks could see scoped plugin state. It did not mount `~/.agents`, the standard user-level Agent Skills location. The new mount makes direct and isolated skill visibility consistent. The documented outer container command also persists both paths.

### 6. No actionable pre-launch failure existed

Previously the first useful error appeared in model prose after startup. The new preflight stops before `codex exec`, names unresolved plugins or skills, and points the operator to `codex plugin list --available --json` or the missing marketplace snapshot.

## Alternatives considered

| Option                                                  | Benefit                                | Rejected limitation                                                                    |
| ------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Document interactive `/plugins` only                    | Small code change                      | Manual, not reproducible, still global unless carefully managed, no early verification |
| Hard-code Superpowers installation                      | Solves the reported example            | Violates the generic requirement and cannot support other skills                       |
| Deploy plugin skills into the checkout                  | Native project discovery               | Mutates the target repository and risks committing generated files                     |
| Use one global Codex home                               | Simple persistence                     | Cross-repository capability leakage                                                    |
| Clone skill repositories during every task              | Independent of plugin catalog          | Moving/unpinned supply-chain input and duplicated plugin semantics                     |
| Repository-scoped Codex home backed by operator catalog | Generic, durable, isolated, verifiable | Requires careful config and marketplace synchronization; selected                      |

## Component and library assessment

- Codex's stable plugin CLI already provides catalog listing, installation, enablement state, and JSON output. Reusing it avoids implementing marketplace semantics.
- The Agent Skills specification defines `.agents/skills` discovery, so a standard mount is preferable to a Hive Mind-only skill format.
- `src/handoff-skill.lib.mjs` proves that capability preparation must happen before the AI command and that generated project skills must be excluded. Issue 2074 uses user/state locations instead because these are operator-provided dependencies.
- `src/isolation-runner.lib.mjs` already centralizes tool authentication/state mounts, making it the correct single propagation point.
- No extra runtime package is required: Node filesystem APIs, `execFile`, GitHub CLI, and Codex CLI cover the flow.

## Failure behavior and diagnostics

Verbose solver logging records detected plugin/skill counts, each provisioned selector, and the scoped state path. Errors retain structured missing identifiers. The preflight fails closed on GitHub discovery failure, malformed Codex JSON, unavailable marketplace state, install failure, or unsuccessful post-install verification. This tracing is always concise; the scoped path detail follows existing verbose logging behavior.

## Security and concurrency considerations

Repository names are sanitized before path construction. Commands use `execFile` argument arrays, avoiding shell interpolation. Credentials are copied only inside the already-persistent operator Codex directory. Repository scopes do not share plugin blocks, while the marketplace content is read-only shared state. Concurrent preflights for the same repository are idempotent at the CLI level; final verification determines success.
