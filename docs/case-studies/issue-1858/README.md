# Case Study - Issue #1858: Agent Authorization Commands

- Issue: https://github.com/link-assistant/hive-mind/issues/1858
- Pull request: https://github.com/link-assistant/hive-mind/pull/1859
- Branch: `issue-1858-fc035c564bc4`
- Date: 2026-06-08

## Summary

Issue #1858 asks for commands like:

```sh
hive auth codex login
hive auth claude login
```

The issue also says those commands should be callable through Telegram for
operator convenience, and the maintainer comment expands the work into a
research task: define what agent authorization means, design how it could be
implemented, support multiple auth identities rather than one global auth, save
evidence under `docs/case-studies/issue-1858`, check existing components and
libraries, and propose implementation plans.

The core finding is that Hive Mind already has two different auth concepts that
must stay separate:

1. **Command authorization**: which Telegram chats/topics may invoke Hive Mind.
   This is already controlled by `TELEGRAM_ALLOWED_CHATS`,
   `TELEGRAM_ALLOWED_TOPICS`, and `isTopicAuthorized`.
2. **Agent credential authorization**: which external account or API key a tool
   such as Claude, Codex, OpenCode, Qwen, Gemini, or GitHub CLI uses. This is
   currently checked reactively by validators, but there is no proactive
   `hive auth` or Telegram `/auth` workflow.

The recommended direction is to implement a small profile-aware auth registry
first, then layer command handlers on top:

```sh
hive auth status
hive auth codex status --profile default
hive auth codex login --profile work --method device
hive auth use codex work
hive solve ... --tool codex --auth-profile work
```

Telegram should expose the same capability as `/auth`, but only for already
authorized chats/topics and with stricter output redaction than normal solve
sessions.

## Evidence Captured

| File                                             | Purpose                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `data/issue-1858.json`                           | Issue body, labels, author, and embedded comments.                 |
| `data/issue-1858-comments.json`                  | Issue conversation comments from the Issues API.                   |
| `data/pr-1859.json`                              | Prepared PR metadata before this case study replaced the scaffold. |
| `data/pr-1859-comments.json`                     | PR conversation comments.                                          |
| `data/pr-1859-review-comments.json`              | PR inline review comments.                                         |
| `data/pr-1859-reviews.json`                      | PR reviews.                                                        |
| `data/docker-git-repo.json`                      | Metadata for the referenced `ProverCoderAI/docker-git` project.    |
| `data/docker-git-readme.md`                      | README of the referenced project, including auth examples.         |
| `data/recent-prs-auth.json`                      | Recent merged PRs found with `auth`.                               |
| `data/recent-prs-codex.json`                     | Recent merged PRs found with `codex`.                              |
| `data/recent-prs-telegram.json`                  | Recent merged PRs found with `telegram`.                           |
| `data/recent-prs-agent.json`                     | Recent merged PRs found with `agent`.                              |
| `data/link-assistant-code-search-qwen-auth.json` | GitHub code search evidence for Qwen auth references.              |
| `research/local-auth-references.txt`             | Focused local code/doc references for auth-related surfaces.       |
| `research-sources.json`                          | Machine-readable list of issue, project, and official doc sources. |

## Requirements

| ID  | Requirement                                                                         | Proposed plan                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Define what `hive auth <tool> login` should mean.                                   | Treat it as a first-class operator workflow for checking, creating, selecting, and validating external tool credentials used by Hive Mind.                               |
| R2  | Support at least Codex and Claude login commands.                                   | Add per-tool auth adapters for `codex` and `claude` first; design the registry so OpenCode, Qwen, Gemini, GitHub CLI, and future agents can use the same metadata shape. |
| R3  | Make the commands callable from Telegram.                                           | Add `/auth` handlers after CLI behavior exists; reuse Telegram chat/topic allowlisting and avoid exposing raw terminal output from credential flows.                     |
| R4  | Support multiple auth identities, not a single global auth.                         | Introduce named auth profiles and make solve/hive execution accept `--auth-profile`; profiles inject tool-specific env overlays such as `CODEX_HOME` or `GH_CONFIG_DIR`. |
| R5  | Compile issue data under `docs/case-studies/issue-1858`.                            | This folder contains raw issue/PR exports, related PR search output, external project evidence, and this analysis.                                                       |
| R6  | Search online for additional facts and data.                                        | Official docs for GitHub CLI, Claude Code, OpenAI Codex, OpenCode, Qwen Code, Gemini CLI, plus the referenced docker-git project were checked.                           |
| R7  | Check known existing components/libraries that solve similar problems or can help.  | Reuse internal validators/session runners; use docker-git, GitHub CLI account switching, Codex/Claude config-dir support, and provider-specific CLI auth as patterns.    |
| R8  | Propose possible solutions and implementation plans for each requirement.           | See the options and phased plan below.                                                                                                                                   |
| R9  | Preserve security when auth runs through a remote command channel such as Telegram. | Restrict invocation, sanitize output, avoid log upload of auth sessions, require explicit profile names, and never store raw secrets in repo-tracked config.             |

## Current Hive Mind State

### What exists

- Telegram solve aliases already map tool names to `solve --tool <tool>`:
  `/claude`, `/codex`, `/opencode`, `/agent`, `/qwen`, and `/gemini`
  (`src/telegram-solve-command.lib.mjs`).
- Telegram command authorization already uses allowed chats and topics:
  `TELEGRAM_ALLOWED_CHATS`, `TELEGRAM_ALLOWED_TOPICS`, and
  `isTopicAuthorized` (`src/telegram-bot.mjs`).
- Tool validation is centralized through `validateToolConnection`
  (`src/tool-connection-validation.lib.mjs`) and per-tool validators.
- Each tool already surfaces reactive auth failures:
  - Claude says to run `claude login`.
  - Codex says to run `codex login`.
  - OpenCode says to run `opencode auth`.
  - Qwen says to run `qwen auth`.
  - Gemini says to authenticate or configure Gemini CLI credentials.
- `/limits` already reads Claude and Codex credential files for usage/plan data:
  `~/.claude/.credentials.json` and `~/.codex/auth.json`
  (`src/limits.lib.mjs`, `src/limits-subscription.lib.mjs`).
- Existing docs already describe manual setup and persistence for GitHub,
  Claude, and Codex in README, Ubuntu, Coolify, and configuration docs.

### What is missing

- No `hive auth` command exists.
- No Telegram `/auth` command exists.
- There is no typed registry of auth profiles.
- Tool execution assumes one ambient credential state per process/user home.
- Validators return mostly boolean/log output rather than reusable structured
  auth status that a command can render safely.
- There is no explicit way to choose a credential identity per Telegram chat,
  queue item, tool run, or repository.

## External Research Findings

### docker-git precedent

The issue body links to
[`ProverCoderAI/docker-git`](https://github.com/ProverCoderAI/docker-git#%D0%B0%D0%B2%D1%82%D0%BE%D1%80%D0%B8%D0%B7%D0%B0%D1%86%D0%B8%D1%8F),
whose README documents:

```sh
bun run docker-git auth github login --web
bun run docker-git auth codex login --web
bun run docker-git auth claude login --web
bun run docker-git auth grok login --web
```

That project also describes a separate Docker environment per repository, issue,
or PR, and an auto mode that chooses an agent based on available authorization.
This is the closest known precedent for the requested Hive Mind command shape.
Hive Mind does not need to copy the full project model, but it should copy the
separation between an auth operation and a later agent run.

### GitHub CLI

Official GitHub CLI docs expose `gh auth login`, `gh auth status`,
`gh auth switch`, `gh auth token`, `gh auth refresh`, and `gh auth logout`.
They also document:

- `GH_TOKEN` / `GITHUB_TOKEN` for non-interactive auth.
- `GH_CONFIG_DIR` to relocate where `gh` stores configuration files.
- `GH_PROMPT_DISABLED` to disable interactive prompts.

Implication: Hive Mind can support multiple GitHub identities either by letting
`gh auth switch` choose among accounts for one config dir, or by setting
`GH_CONFIG_DIR` per profile. The second option is easier to isolate per solve
run.

### Claude Code

Official Claude Code auth docs say first launch opens a browser login, and users
can use `/logout` to re-authenticate. On Linux, credentials live in
`~/.claude/.credentials.json` with mode `0600`; `CLAUDE_CONFIG_DIR` relocates
the credential file on Linux and Windows. Claude also supports cloud provider
credentials, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`,
`CLAUDE_CODE_OAUTH_TOKEN`, and subscription OAuth, with a documented precedence
order.

Implication: a Claude auth profile should be represented as an env overlay,
not just "run `claude login` once". At minimum it needs a profile-specific
`CLAUDE_CONFIG_DIR` or a project-approved equivalent to avoid overwriting the
default user credential.

### Codex

Official OpenAI Codex docs say the CLI supports ChatGPT sign-in and API key
sign-in. Codex caches credentials in `~/.codex/auth.json` or an OS credential
store, controlled by `cli_auth_credentials_store`. `CODEX_HOME` relocates
Codex config, auth, logs, sessions, skills, and package metadata. Headless
login supports `codex login --device-auth`; trusted automation can use
`CODEX_ACCESS_TOKEN`, and one-shot `codex exec` can use `CODEX_API_KEY`.

Implication: Codex is the cleanest first target for multi-profile auth because
`CODEX_HOME` naturally scopes the whole credential/config/session tree. Codex
`--profile` is useful for config layers, but separate `CODEX_HOME` values are
the stronger primitive for separate credentials.

### OpenCode

OpenCode's current provider docs describe `/connect` for adding provider API
keys and store those keys in `~/.local/share/opencode/auth.json`. The local
Hive Mind code currently advises `opencode auth` on auth failures. OpenCode
supports many model providers, so there may be multiple provider credentials
inside one OpenCode auth file.

Implication: a Hive Mind auth profile for OpenCode should include both the
OpenCode credential home and the selected model/provider, not just a single
"OpenCode account".

### Qwen Code

Qwen Code officially supports both an in-session `/auth` command and a
standalone `qwen auth` CLI command. It provides `qwen auth status`, interactive
setup, Coding Plan setup, API key setup, and security notes warning not to
commit API keys and to treat terminal output as sensitive if credentials are
printed.

Implication: Qwen should use the common auth registry, but its command adapter
should preserve multiple auth methods rather than assuming OAuth.

### Gemini CLI

Gemini CLI supports Google login, Gemini API key, and Vertex AI authentication.
Google login requires a browser that can reach the CLI localhost callback and
caches credentials locally. Headless mode relies on existing cached credentials
or env vars such as `GEMINI_API_KEY`, `GOOGLE_API_KEY`,
`GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, and
`GOOGLE_CLOUD_LOCATION`.

Implication: Gemini profiles need to distinguish "cached Google login" from
API-key and Vertex profiles. Env-only profiles may be enough for headless
automation.

## Design Principles

1. **Do not conflate command access with credential identity.** Telegram
   allowlisting decides who may invoke `/auth`; auth profiles decide which
   external account a later run uses.
2. **Never store secrets in Hive Mind config.** Store profile metadata, paths,
   env var names, and labels. Raw tokens stay in tool-managed credential files
   or external secret stores.
3. **Prefer profile-specific homes over mutable global switches.** A profile
   env overlay such as `CODEX_HOME=/var/lib/hive/auth/codex-work` or
   `GH_CONFIG_DIR=/var/lib/hive/auth/gh-work` is safer than changing one global
   active account for all concurrent runs.
4. **Treat auth terminal output as sensitive.** Auth output may contain URLs,
   one-time codes, API keys, or copied tokens. It should not be uploaded to PRs
   or shown to broad group chats without filtering.
5. **Keep login adapters explicit.** Do not run arbitrary user-supplied shell
   through `/auth`. Commands should be generated from a tool/action/method
   allowlist.
6. **Make status structured before making login interactive.** A read-only
   status path is the safest first release and gives the UI a stable contract.

## Proposed Auth Profile Model

The registry can be a JSON or TOML file under a Hive Mind state directory, not
inside the repository:

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "codex-work",
      "tool": "codex",
      "label": "Codex work account",
      "credentialHome": "/var/lib/hive-mind/auth/codex/work",
      "env": {
        "CODEX_HOME": "/var/lib/hive-mind/auth/codex/work"
      },
      "defaultFor": [
        {
          "scope": "telegram-chat",
          "id": "-1001234567890"
        }
      ],
      "createdAt": "2026-06-08T00:00:00Z"
    }
  ]
}
```

Profile metadata should include:

- `id`: stable operator-chosen profile id.
- `tool`: `claude`, `codex`, `opencode`, `agent`, `qwen`, `gemini`, or `github`.
- `label`: human-readable name without secrets.
- `credentialHome`: directory owned by the runtime user, mode checked before use.
- `env`: environment overlay injected only into the auth command or agent run.
- `status`: last validation result, timestamp, and non-secret account summary.
- `defaultFor`: optional chat/topic/repo/default mapping.

For tools that need multiple credentials at once, the model can grow a
`provider` or `method` field without changing CLI shape.

## Command Surface

### CLI

Initial CLI shape:

```sh
hive auth
hive auth status
hive auth <tool> status [--profile <id>]
hive auth <tool> login --profile <id> [--method browser|device|api-key|token]
hive auth use <tool> <profile-id> [--scope global|chat:<id>|topic:<chat>:<thread>|repo:<owner/repo>]
hive auth profiles [--tool <tool>]
hive auth remove <tool> <profile-id>
```

Execution commands should accept:

```sh
hive ... --auth-profile <id>
solve ... --auth-profile <id>
```

If `--auth-profile` is omitted, profile resolution should be deterministic:

1. Tool-specific default for the Telegram topic.
2. Tool-specific default for the Telegram chat.
3. Tool-specific default for the repository.
4. Tool-specific global default.
5. Ambient current behavior.

### Telegram

Telegram should mirror the safe subset:

```text
/auth
/auth status
/auth codex status
/auth codex login work device
/auth use codex work
```

Recommended restrictions:

- Only allow `/auth` from already authorized chats/topics.
- Consider requiring a bot-owner/admin allowlist for `login`, `remove`, and
  future `logout`.
- Prefer sending one-time auth links/codes by direct message when possible.
- Never post full raw auth logs into group chats.
- Show only sanitized status fields in group chats.

## Solution Options

### Option A - Status-only documentation and command

Add `hive auth status` and `/auth status` as read-only wrappers around existing
validators and `/limits` logic. This is the safest first code change and gives
operators a clear view of which tools are ready.

Pros:

- Low security risk.
- Reuses existing validators.
- Useful even before multi-profile login exists.

Cons:

- Does not fulfill the `login` part of the issue.
- Does not solve multi-auth by itself.

### Option B - Single-profile login commands

Add `hive auth codex login` and `hive auth claude login` that launch the
corresponding tool login flow in the same runtime account/home Hive Mind already
uses.

Pros:

- Closest minimal implementation of the issue body.
- Easy for a single-operator server.

Cons:

- Reinforces one global credential per tool.
- Risky with concurrent runs.
- Hard to make safe from Telegram because login output may reveal sensitive
  data.

### Option C - Profile-aware auth registry (recommended)

Add the auth registry, structured status, per-tool env overlays, and then
profile-aware login commands.

Pros:

- Satisfies the maintainer's multi-auth requirement.
- Avoids mutating global auth state for every run.
- Scales to all supported tools.
- Gives solve/hive/queue code an explicit account identity to carry.

Cons:

- Requires parser, registry, validation, execution, and docs work.
- Requires careful migration for existing ambient credentials.

### Option D - External secret manager only

Do not implement interactive login. Document how operators configure external
secrets and expose only `hive auth status`.

Pros:

- Strongest security posture.
- Best for production and shared servers.

Cons:

- Does not meet the Telegram convenience request.
- Does not help local/small deployments that rely on browser/device login.

## Recommended Implementation Plan

### Phase 1 - Structured status and registry

1. Add `src/auth-profiles.lib.mjs` for loading/saving non-secret profile
   metadata outside the repo.
2. Add `src/tool-auth-registry.lib.mjs` with per-tool metadata:
   executable, status adapter, supported login methods, env overlay builder,
   and credential-home defaults.
3. Convert validators to return structured status:
   `ok`, `tool`, `profile`, `authMethod`, `accountSummary`, `message`,
   `checkedAt`, and `safeDetails`.
4. Add `hive auth status` and `hive auth <tool> status`.
5. Add docs for profile storage, file permissions, and migration from ambient
   credentials.

### Phase 2 - Codex and Claude login

1. Implement `hive auth codex login --profile <id> --method device` using
   `CODEX_HOME=<profile-home> codex login --device-auth`.
2. Implement `hive auth claude login --profile <id>` using
   `CLAUDE_CONFIG_DIR=<profile-home> claude` or the safest documented Claude
   login entrypoint available in the installed version.
3. Add output sanitizer rules for login URLs, one-time codes, tokens, and common
   secret shapes.
4. Store only profile metadata after successful validation.
5. Do not implement logout/remove until status and login are stable.

### Phase 3 - Telegram `/auth`

1. Add parser tests for `/auth`.
2. Gate every `/auth` command with existing chat/topic authorization.
3. Add a stricter allowlist for mutating auth actions.
4. Reuse isolated command-session infrastructure, but disable PR log upload and
   broad log replay for auth sessions.
5. Render compact, sanitized status cards.

### Phase 4 - Profile-aware solve/hive execution

1. Add `--auth-profile` to solve/hive.
2. Resolve defaults by topic, chat, repo, then global profile.
3. Inject profile env overlays into tool execution and validation.
4. Persist selected profile on queue items so delayed runs use the intended
   identity.
5. Include non-secret profile id in run summaries for auditability.

### Phase 5 - Additional tools and lifecycle commands

1. Add GitHub profile support with `GH_CONFIG_DIR`.
2. Add OpenCode profile support with provider-aware status.
3. Add Qwen status/login adapters.
4. Add Gemini env-only and cached-login profiles.
5. Add `remove`, `logout`, and `rotate` only with explicit confirmation and
   clear destructive semantics.

## Test Plan

Automated tests should start with fake CLIs and no real credentials:

- Unit tests for `hive auth` parser and Telegram `/auth` parser.
- Unit tests for profile registry validation:
  duplicate IDs, invalid tool names, path traversal, missing profile, bad file
  permissions, and non-secret serialization.
- Unit tests for env overlay builders:
  `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GH_CONFIG_DIR`, Gemini env-only profiles,
  and OpenCode credential homes.
- Unit tests for token/log sanitization on auth outputs.
- Integration tests with fake `codex`, `claude`, `qwen`, `gemini`, and
  `opencode` binaries that simulate success, auth failure, timeout, and
  one-time-code output.
- Telegram handler tests for authorized chat, unauthorized chat, authorized
  topic, unauthorized topic, status action, and mutating action.
- Regression tests that concurrent runs with different profiles receive
  different env overlays.

Manual verification should include:

- A real Codex device-login profile on a disposable account.
- A real Claude login profile on a disposable account or test subscription.
- A Telegram `/auth status` screenshot or transcript with secrets redacted.

## Security Checklist

- Do not store raw tokens in profile metadata.
- Do not print `gh auth token`, `auth.json`, `.credentials.json`, API keys, or
  access-token JSON.
- Do not upload auth-session logs to PR comments, gists, or public artifacts.
- Run auth commands from a fixed allowlist, not arbitrary shell fragments.
- Check credential directory ownership and permissions before use.
- Make destructive actions (`logout`, `remove`, `rotate`) explicit and
  confirmation-gated.
- Preserve command authorization checks for every Telegram entrypoint.
- Carry profile IDs into solve queue items to avoid later default changes
  silently changing the account used by a delayed run.

## Open Questions

- Should Hive Mind expose auth for GitHub CLI in the same command group, or keep
  `gh auth` setup separate because GitHub identity affects PR authorship and
  repository mutation?
- Should Telegram mutating auth commands be owner-only even inside allowed
  chats?
- Where should production profile metadata live by default:
  `$HOME/.hive-mind/auth-profiles.json`, XDG state, or an explicit env-var path?
- Should the first implementation support copying existing ambient credentials
  into a named profile, or require fresh login per profile?
- Should auth profiles be scoped by repository owner/repo in addition to
  Telegram chat/topic?

## Conclusion

The requested command is useful, but the safe implementation is not just a thin
wrapper around `codex login` and `claude login`. Hive Mind runs autonomous tools
from Telegram, queue workers, and long-lived sessions, so auth must be explicit,
profile-aware, sanitized, and carried into solve execution. The recommended
path is Option C: implement structured status and non-secret auth profiles
first, then add Codex and Claude login adapters, then expose the safe subset in
Telegram.
