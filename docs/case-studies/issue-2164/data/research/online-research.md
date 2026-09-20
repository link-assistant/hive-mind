# Online research notes — issue #2164

Collected 2026-08-21 UTC with the `WebSearch` tool. Each entry records what was
searched for, the sources that answered it, and the single fact that mattered
for the design in `../../README.md`. Nothing here is a substitute for the
first-party evidence in `../upstream/` — these are the external comparisons the
issue asked for ("make sure to search online for additional facts and data",
"check known existing components/libraries").

## 1. Blocking destructive git operations at a proxy

Query: _"FINOS GitProxy open source git push policy enforcement proxy"_.

Sources:

- <https://github.com/finos/git-proxy>
- <https://git-proxy.finos.org/docs/>
- <https://www.finos.org/blog/git-proxy-v2.0-protect-your-pushes-everywhere-your-code-goes>
- <https://www.npmjs.com/package/@finos/git-proxy>

Findings:

- FINOS **GitProxy** is a production-grade, FINOS-_graduated_ MIT-licensed
  Node.js service that "stands between developers and a Git remote endpoint
  (e.g. github.com) and applies rules and workflows (configurable as plugins)
  to all outgoing git push operations". It is used in production by Citi, RBC,
  NatWest and G-Research.
- v2.0 added **both HTTP/HTTPS and SSH** interception "with identical security
  scanning and validation", which is what makes it usable in front of an agent
  that may be handed either remote form.
- It is explicitly documented as usable "on a local environment to enforce a
  single developer's best practices" — i.e. the single-host, single-operator
  shape Hive Mind needs, not only the enterprise shape.

Relevance: this is the closest existing component to requirement R13's `git
push` half, and it is the strongest argument that intercepting the _git
transport_ is a separate concern from intercepting the _GitHub REST/GraphQL
API_. Link.Assistant.Router only does the latter and says so (see
`../upstream/router-README.md`).

## 2. Per-agent credential isolation in LLM gateways

Query: _"LiteLLM virtual keys per-agent isolation sandbox container secret injection"_.

Findings:

- **LiteLLM** virtual keys are the mainstream implementation of the same idea as
  the router's `la_sk_…` per-task tokens: one gateway holds the real provider
  credential, and each caller gets a revocable key with its own budget, rate
  limit, and per-key logs.
- LiteLLM's agent-sandbox work injects per-sandbox secrets into the container
  environment with a `CONTAINER_ENV_` prefix rather than mounting the operator's
  credential files — the same "env, not mount" boundary that `--use-router`
  needs at `getDockerIsolationAuthMounts`.

Relevance: confirms that "one gateway credential + N scoped per-task keys" is
the industry-standard shape, and that the router's
`--max-requests/--max-tokens/--rate-limit-per-minute` triple is feature-comparable.
It also means Hive Mind is not inventing a mechanism here; it is adopting one.

## 3. How an agentic CLI is pointed at a gateway

Query: _"Claude Code ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN proxy settings.json isolate credentials container"_.

Sources:

- <https://code.claude.com/docs/en/authentication>
- <https://www.coderouter.io/blog/claude-code-401-custom-base-url-fix>
- <https://buzzai.cc/blog/anthropic-base-url-claude-code-guide>

Findings:

- `ANTHROPIC_BASE_URL` redirects **every** request the CLI makes, "including its
  agentic sub-loops and background calls" — so a single environment variable is
  sufficient to guarantee that no request escapes the router.
- `ANTHROPIC_AUTH_TOKEN` is sent as `Authorization: Bearer`, while
  `ANTHROPIC_API_KEY` is sent as `x-api-key`. Gateways that mint their own keys
  (the router's `la_sk_…` is one) need the **`ANTHROPIC_AUTH_TOKEN`** form; using
  `ANTHROPIC_API_KEY` is the documented cause of a 401 against a custom base URL.
  (The router accepts either header, but the Bearer form is the one to emit.)
- The variables can be set in the process environment or in
  `~/.claude/settings.json` under `env`. Hive Mind should use the process
  environment, because the settings file is exactly the artifact `--use-router`
  is trying to stop mounting.

Relevance: this pins the concrete mechanism for R2/R12 on the Claude side and
explains why the router ships `router clients setup <client>` — it writes the
per-client equivalent of these variables for codex/qwen/gemini/opencode/agent,
whose knobs are not `ANTHROPIC_*`.

## 4. Branch protection as the backstop for the git transport

No search was needed for this one: it is stated as a limitation by the upstream
project itself, and Hive Mind already implements the backstop.

- Router README: "branch protection remains necessary because a force-push over
  the git transport never reaches these routes"
  (`../upstream/router-README.md`, line 700).
- Hive Mind already ships `src/protect-branch.mjs`, which PUTs
  `allow_force_pushes: false` and `allow_deletions: false` on the default branch
  via `repos/{owner}/{repo}/branches/{branch}/protection`.

Relevance: R13 has a GitHub-side answer that exists today and a transport-side
answer that does not. The gap analysis in `../../README.md` separates them.
