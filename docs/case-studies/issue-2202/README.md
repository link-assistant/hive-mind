# Issue #2202 — new models arrive faster than releases do: live catalogues, `/models`, and the router

## Executive summary

Hive Mind's model catalogue is a **static table compiled into the package**.
`src/models/index.mjs` holds 176 aliases across six tools, and the only way a
new model becomes usable is for somebody to edit that file, cut a release, and
for every operator to upgrade. On 2026-09-04 that table did not contain
`claude-fable-5-1`, released three days earlier, or `gpt-6-astra`, released one
day earlier — the two models named in this issue's title.

That is the visible symptom. The measurements collected here show the
structural problem underneath it, and it is worse than "the table is out of
date":

1. **Every third-party aggregator is also behind.** models.dev, OpenRouter and
   LiteLLM all carry `claude-fable-5-1` (released 2026-09-01) and **none** of
   them carries `gpt-6-astra` (released 2026-09-03) —
   [`data/measurements/aggregator-coverage-2026-09-04.md`](data/measurements/aggregator-coverage-2026-09-04.md).
   Swapping a bundled table for an aggregator would not have solved this issue;
   it would only have moved the staleness one hop away.
2. **The locally installed CLI is also behind.** `codex debug models` on
   `codex-cli 0.150.1` returns 10 models and no `gpt-6-astra`, while
   `@openai/codex` is published at `0.153.2`. _Every_ agentic CLI on this host
   is behind its published version —
   [`data/measurements/cli-versions-2026-09-04.md`](data/measurements/cli-versions-2026-09-04.md).
   This is why R6 ("check if a new version is available … before providing a new
   models list") is not housekeeping: on a Codex-only host it is the **only**
   mechanism in the entire design that can ever surface `gpt-6-astra`.
3. **Only the vendor is current.** `platform.claude.com` and
   `developers.openai.com` both document their day-old models fully, and both
   expose a `GET …/v1/models` listing endpoint that takes no prompt, returns no
   `usage` block, and therefore cannot be billed. The issue's hard constraint —
   "models extraction should never trigger any tokens expense" — is not a
   restriction on this design, it is a description of it.
4. **`--use-router` cannot reach any of those routes as currently wired.**
   At the time this study was written Hive Mind pinned
   `ghcr.io/link-assistant/router:0.119.0`
   (`src/router-isolation.lib.mjs:55`); upstream is at **v1.2.0**, 26 releases
   later. (This PR moves the pin to `0.125.4`, the highest `0.x` release — see
   solution 6 below — which changes the distance but not the dialect.) Router **v1.0.0** moved every public route under `/api/health`,
   `/api/management/*` and `/api/services/*`
   ([`data/upstream/router-route-contract.rs`](data/upstream/router-route-contract.rs)),
   while Hive Mind still emits the pre-1.0 shapes: `ANTHROPIC_BASE_URL = baseUrl`,
   `OPENAI_BASE_URL = ${baseUrl}/v1`, Codex `base_url = "${baseUrl}/v1"`, git
   `insteadOf` → `${routerUrl}git/`, gh REST → `/api/v3/`
   ([`data/hive-mind/router-wiring.md`](data/hive-mind/router-wiring.md)).
   This is the concrete, checkable answer to R4's "double check that after all
   recent changes to router, our Hive Mind and `--use-router` support all the
   best features of it": today it does not, and bumping the pin without
   migrating the URLs would break `--use-router` outright. Probing both images
   side by side
   ([`data/measurements/router-route-comparison-2026-09-04.md`](data/measurements/router-route-comparison-2026-09-04.md))
   confirms the two dialects are disjoint — and turns up one route that has no
   replacement `gh` can reach, which is why Hive Mind learns both dialects
   instead of simply moving the pin (G4).
5. **The one cache that exists has no expiry.** `fetchModelsDevApi()`
   (`src/models/index.mjs:1000`) memoises `https://models.dev/api.json` in a
   module-level `let modelsDevCache = null` with no TTL and no disk backing:
   within a process it never refreshes, and across processes it never survives.
   R9 asks for "cached for at least 1 hour" — which, read carefully, is a
   _floor on freshness cost_, not a ceiling on staleness. The current
   implementation satisfies neither half.

**The honest headline.** The issue's framing — "we will get support for all new
models immediately" — is achievable for Claude and for Codex, and is _not_
achievable in the general case. `gpt-6-astra` on 2026-09-03 was a limited
preview for trusted partners; an account without that entitlement will not see
it in any live catalogue, correctly. And `claude-mythos-5-1` is a published,
documented API ID that is **invite-only** (Project Glasswing) — Hive Mind's
static table already ships `claude-mythos-5`, a model almost every user cannot
call. A live catalogue is therefore not only fresher than the static table, it
is _more honest_: it advertises what this account can actually reach. The
deliverable this case study argues for is a **merged, source-labelled**
catalogue — bundled ∪ live — where every entry says where it came from, rather
than a live catalogue that pretends to replace the bundled one. That is exactly
what R5's "from fully supported, to hot loaded" asks for.

## Scope and evidence

Every claim below is derived from an artifact committed under [`data/`](data),
so a reader can re-check it without network access. Checksums are in
[`MANIFEST.md`](MANIFEST.md). Hive Mind code is quoted at commit `e062446e`.

| Source                               | Location                                                                                                                                                                                                                   | What it establishes                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue #2202 body and comment feed    | [`data/github/issue-2202.json`](data/github/issue-2202.json), [`issue-2202-comments.json`](data/github/issue-2202-comments.json)                                                                                           | The verbatim requirement text. The comment feed is empty, so the body plus the title are the only specification.                                                                                      |
| PR #2203 and its three comment feeds | [`data/github/pr-2203.json`](data/github/pr-2203.json), [`pr-2203-review-comments.json`](data/github/pr-2203-review-comments.json), [`pr-2203-conversation-comments.json`](data/github/pr-2203-conversation-comments.json) | All three are empty: no review feedback exists, nothing is asked beyond the issue.                                                                                                                    |
| Hive Mind built-in catalogue, dumped | [`data/hive-mind/builtin-model-catalogue.json`](data/hive-mind/builtin-model-catalogue.json)                                                                                                                               | The exact aliases, defaults and fallback chains that ship with the installation, produced by [`experiments/dump-builtin-model-catalogue.mjs`](../../../experiments/dump-builtin-model-catalogue.mjs). |
| Hive Mind router wiring, quoted      | [`data/hive-mind/router-wiring.md`](data/hive-mind/router-wiring.md)                                                                                                                                                       | The pinned image, the legacy base URLs, the credential mounts, and the `/v1/models` references.                                                                                                       |
| Router release history               | [`data/upstream/router-releases.json`](data/upstream/router-releases.json), [`router-releases-since-0.119.0.md`](data/upstream/router-releases-since-0.119.0.md)                                                           | 143 releases; the 26 published after the pin, with bodies.                                                                                                                                            |
| Router route table                   | [`data/upstream/router-route-contract.rs`](data/upstream/router-route-contract.rs)                                                                                                                                         | The authoritative post-1.0 path for every service, including the five model-catalogue routes.                                                                                                         |
| Router client guide                  | [`data/upstream/router-with-command.md`](data/upstream/router-with-command.md)                                                                                                                                             | Per-client dialects and base URLs, `--pick-model`, server/token resolution order, and the "Claude Code 2.1.255 or newer" floor.                                                                       |
| Live Codex catalogue                 | [`data/measurements/codex-debug-models.json`](data/measurements/codex-debug-models.json)                                                                                                                                   | The 10 models a token-free local command returns, including two Daybreak aliases Hive Mind does not know.                                                                                             |
| models.dev extract                   | [`data/measurements/models-dev-relevant-entries.json`](data/measurements/models-dev-relevant-entries.json)                                                                                                                 | The fallback's full metadata shape for the relevant families.                                                                                                                                         |
| Catalogue gap analysis               | [`data/measurements/catalogue-gap-analysis.json`](data/measurements/catalogue-gap-analysis.json)                                                                                                                           | Bundled ↔ live ↔ models.dev set differences, in both directions.                                                                                                                                      |
| Aggregator coverage                  | [`data/measurements/aggregator-coverage-2026-09-04.md`](data/measurements/aggregator-coverage-2026-09-04.md)                                                                                                               | Three independent aggregators, one shared blind spot.                                                                                                                                                 |
| CLI version drift                    | [`data/measurements/cli-versions-2026-09-04.md`](data/measurements/cli-versions-2026-09-04.md)                                                                                                                             | Installed vs published for six agentic CLIs.                                                                                                                                                          |
| Router route surface                 | [`data/measurements/router-route-comparison-2026-09-04.md`](data/measurements/router-route-comparison-2026-09-04.md)                                                                                                       | `0.119.0` vs `1.2.0`, 17 paths each, probed against running containers started with Hive Mind's own arguments.                                                                                        |
| Router credentials and tokens        | [`data/measurements/router-credentials-and-tokens-2026-09-04.md`](data/measurements/router-credentials-and-tokens-2026-09-04.md)                                                                                           | On `1.x` the credential mount is still the wiring — `auth import` is the wrong tool for it — and the token lease keeps working across the dialect change.                                             |
| Router pin `0.125.4`                 | [`data/measurements/router-pin-0.125.4-2026-09-04.md`](data/measurements/router-pin-0.125.4-2026-09-04.md)                                                                                                                 | `0.119.0` vs `0.125.4`: identical route surface, identical task-token lease, identical credential discovery — and the `version` header that unblocks new Codex models.                                |
| Online research notes                | [`data/research/online-research.md`](data/research/online-research.md)                                                                                                                                                     | Vendor-quoted specs for Fable 5.1, Mythos 5.1 and GPT-6 Astra; the Anthropic Models API field list; the router routes.                                                                                |

## Requirements reconstructed

The issue title carries R1; the body carries the rest. Each row quotes the
sentence it is derived from.

| #       | Requirement                                                                                                                                                                                                                             | Source sentence                                                                                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | Add support for all new models, specifically GPT-6 Astra and Fable 5.1.                                                                                                                                                                 | Title: "Add support for all new models like GPT-6 Astra and Fable 5.1"                                                                                                                                                                                                                         |
| **R2**  | Add an experimental mechanism that gets real-time data about models.                                                                                                                                                                    | "We also need to add experimental mechanism that will try to get real time data about models."                                                                                                                                                                                                 |
| **R3**  | Use the Link.Assistant Router's API for the model list; the router must be initialized, mapped and mounted with claude and codex credential files/folders; report upstream issues for anything missing.                                 | "As I understand we can use our …/router for it… Router should be initialized, mapped, and mounted with claude and codex credential files/folders, if it does not support that mode of operation, we should ensure it will, by reporting issues on missing features."                          |
| **R4**  | Re-audit `--use-router` against the router's current feature set.                                                                                                                                                                       | "We should also double check that after all recent changes to router, our Hive Mind and --use-router support all the best features of it."                                                                                                                                                     |
| **R5**  | Add a `/models` command with `--tool claude`, `--tool codex` and others, listing merged models and distinguishing live-loaded from bundled.                                                                                             | "We should also add /models command, with options like `--tool claude` and `--tool codex`… list of merged models (from fully supported, to hot loaded)… which models are loaded live… and which models are included with Hive Mind installation."                                              |
| **R6**  | `/models` and every claude/codex-relevant command must check for and apply CLI updates before listing models or starting a task.                                                                                                        | "Also /models and each /solve and other commands that relevant for claude/codex tools should check if new version available, and before starting task execution or before providing new models list - we should update them."                                                                  |
| **R7**  | Fallbacks beyond the router API are allowed (including TUI), but **no extraction method may spend tokens**; any that does must be removed from the codebase.                                                                            | "As we may need to fallback from direct API via router usage to some way of getting list of models from claude/codex (including but not exclusive to usage of TUI), yet models extraction should never trigger any tokens expense, otherwise such methods must be excluded from our codebase." |
| **R8**  | Obtain every other parameter of each hot-loaded model from the provider's native API, website, docs or other official sources, with models.dev as a fallback.                                                                           | "We should also double check we can get all other parameters of these each hot loaded model using native API, website, docs other official sources of each provider, and models.dev as a fallback."                                                                                            |
| **R9**  | Hot-loaded technical details must be cached for at least 1 hour.                                                                                                                                                                        | "So hot load of all technical details is available and cached for at least 1 hour, so we don't request that data from bot too much."                                                                                                                                                           |
| **R10** | Compile the issue's data into `./docs/case-studies/issue-2202`, do a deep case-study analysis with online research, enumerate every requirement, and propose solutions/plans per requirement including a survey of existing components. | "We need to collect data related about the issue to this repository… propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries…)."                                                                                          |

---

## Part 1 — Where Hive Mind stands today

### 1.1 The catalogue is one static table

[`data/hive-mind/builtin-model-catalogue.json`](data/hive-mind/builtin-model-catalogue.json),
generated from `src/models/index.mjs` at commit `e062446e`:

| Tool       | Default                 | Aliases | Distinct resolved IDs |
| ---------- | ----------------------- | ------- | --------------------- |
| `claude`   | `opus`                  | 31      | 15                    |
| `codex`    | `gpt-5.6-sol`           | 73      | 60                    |
| `agent`    | `nemotron-3-super-free` | 31      | 23                    |
| `opencode` | `grok-code-fast-1`      | 11      | 7                     |
| `qwen`     | `qwen3-coder-plus`      | 10      | 6                     |
| `gemini`   | `flash`                 | 20      | 7                     |

There is no runtime path that can add an entry to any of these maps. The one
partial exception proves the rule and is the template for everything below:
`getInstalledCodexModels()` (`src/models/index.mjs`) shells out to
`codex debug models`, parses the slugs, and memoises the promise — but it is
used **only** by `resolveRuntimeDefaultModel()` to pick a working default from a
hard-coded fallback chain. Its result is never merged into the catalogue and
never shown to a user.

### 1.2 What the table gets wrong today

[`data/measurements/catalogue-gap-analysis.json`](data/measurements/catalogue-gap-analysis.json):

**Missing from the bundled catalogue but real:**

- `claude-fable-5-1` — the current Anthropic flagship for "demanding reasoning
  and long-horizon agentic work"; present in models.dev, OpenRouter and LiteLLM.
- `claude-mythos-5-1` — published, documented, invite-only.
- `gpt-6-astra` — published, documented, in no aggregator and in no local CLI.
- `gpt-5.6-cyber` — a current GPT-5.6 model (400K context, 128K output,
  knowledge cutoff 2026-02-16), gated behind the Daybreak program.
- `gpt-daybreak-blue-latest`, `gpt-daybreak-red-latest` — **already advertised
  by the locally installed Codex CLI** and still absent from Hive Mind's table.
  This is the cleanest single proof that a live merge is worth having: the data
  is already on disk, free, and simply not read.
- `gpt-5.6`, `gpt-5.5-pro`, `gpt-5.4-pro`, `gpt-5.3-chat-latest` — in models.dev,
  not in the table.

**In the bundled catalogue but not in models.dev:** `claude-mythos-5`,
`opusplan`, `formal-ai`, `codex-auto-review`, `gpt-5.1-codex-max`,
`gpt-5.2-codex`, `gpt-5.5-mini`, `gpt-5.5-nano`, and two retired Claude 3
snapshots. Some are legitimately Hive Mind's own (`opusplan`, `formal-ai`,
`codex-auto-review`); the rest are the residue of a table nobody prunes.

Both directions matter. A merged view that only _adds_ live models would keep
advertising `claude-3-haiku-20240307`; a merged view that labels each entry's
source lets a user see at a glance that it is bundled-only and unverified.

### 1.3 The models.dev cache neither caches nor expires

`src/models/index.mjs:991-1001`:

```js
/**
 * Cached models.dev API response to avoid repeated network requests.
 */
let modelsDevCache = null;

…

const fetchModelsDevApi = async () => {
  if (modelsDevCache) return modelsDevCache;
  …
```

A module-level variable. Within one `solve` process the 4.5 MB payload is
fetched once and then **never refreshed, however long the process runs**; across
the bot's many short-lived child processes it is fetched **every time**. R9's
"cached for at least 1 hour" needs an on-disk, TTL-stamped cache, and the
repository already has the exact primitive for it — see §4.3.

### 1.4 The updater exists and is wired into exactly one caller

`src/agentic-cli-updater.lib.mjs` implements everything R6 needs:
`AGENTIC_CLI_TARGETS` for seven CLIs, `readInstalledCliVersion`,
`readLatestPublishedVersion`, `installAgenticCli`, a `withStateLock`-guarded
journal at `~/.hive-mind/agentic-cli-updates.json`, a
`DEFAULT_CLI_UPDATE_INTERVAL_MS` of 6 hours, and `HIVE_MIND_AGENTIC_CLI_*`
env-var controls. Its only importer in `src/` is
`src/formal-ai-maintenance.lib.mjs:23` — the bot's idle loop. Neither `solve`,
nor `task`, nor any Telegram command consults it. R6 is therefore almost
entirely a wiring job, not a new subsystem.

### 1.5 There is no `/models` command and no CLI dispatcher

`grep` for a `models` command in `src/telegram-bot.mjs` returns only the import
of `src/models/index.mjs`. `package.json` declares ten bins (`hive`, `solve`,
`task`, `fix`, `hive-cleanup`, `review`, `configure-claude`, `start-screen`,
`hive-screens`, `hive-telegram-bot`) and **no generic subcommand dispatcher**,
so `/models` is primarily a Telegram command; a `hive-models` bin can be added
alongside it, but it is a separate entry, not a subcommand of an existing one.

---

## Part 2 — What the router already provides

### 2.1 The five catalogue routes

From [`data/upstream/router-route-contract.rs`](data/upstream/router-route-contract.rs),
the router's own route table:

| Service   | Catalogue route                          |
| --------- | ---------------------------------------- |
| Anthropic | `GET /api/services/anthropic/v1/models`  |
| OpenAI    | `GET /api/services/openai/v1/models`     |
| Codex     | `GET /api/services/codex/v1/models`      |
| Qwen      | `GET /api/services/qwen/v1/models`       |
| Gemini    | `GET /api/services/gemini/v1beta/models` |

That is R3 answered in the affirmative: the router does expose the model list
over its API, for every tool family Hive Mind supports, on a stable path.

### 2.2 Credential adoption is already implemented

R3 asks that the router be "initialized, mapped, and mounted with claude and
codex credential files/folders". Two of the three verbs already work today:
`ROUTER_CREDENTIAL_MOUNTS` (`src/router-isolation.lib.mjs:81`) bind-mounts
`~/.claude`, `~/.codex`, `~/.gemini` and `~/.qwen` into the sidecar and points
`CLAUDE_CODE_HOME` / `CODEX_HOME` / `GEMINI_HOME` / `QWEN_HOME` at them. What
"initialized" adds is the router-side adoption step, which upstream shipped
after the pin: `router auth claude --from-claude-home` and
`router auth codex --from-codex-home` turn a mounted vendor home into a
router-held subscription. Hive Mind does not call either.

So R3 needs **no upstream issue** — the feature exists. It needs the pin moved
and the adoption commands invoked.

### 2.3 What else arrived in the 26 releases since the pin

From [`data/upstream/router-releases-since-0.119.0.md`](data/upstream/router-releases-since-0.119.0.md),
the items that bear on this issue:

- **v1.0.0** — the route reclassification (§3.1) and a split between the
  inference-only listener and the management listener.
- Routing is derived from **live provider catalogs**, with no production
  fallback to hard-coded model names; `GET /v1/models` reports
  `degraded_providers`.
- `--bridge-model-policy` (`first-advertised` | `last-advertised`) and a
  `model_selection_required` error instead of silently substituting a model.
- `--pick-model`: ask the router to choose from the target's live catalogue and
  report what it picked and why.
- `--json` on `tokens list`, `accounts list`, `providers list`, `clients list`.
- A valid client token is now required before live catalogs are returned.
- Codex subscriptions send a `version` header when proxying to the ChatGPT
  backend (default `0.144.1`, overridable with `CODEX_CLIENT_VERSION`). The
  backend gates newer models — `gpt-5.6-luna` is upstream's own example —
  behind a recent client version; without the header `POST /responses` answers
  `Model not found`.
- macOS Claude credentials live in the login Keychain, and the newer of
  Keychain/file wins.

The `--pick-model` and "no fallback to hard-coded model names" items are
independent confirmation that the upstream reached the same conclusion this
issue reaches: **live catalogues, not compiled-in tables.**

---

## Part 3 — Gap analysis

### G1 — `--use-router`'s base URLs predate router 1.0 (blocking for R3/R4)

Hive Mind emits, all from `src/router-isolation.lib.mjs`:

| What                | Current (line)                             | Required under router ≥ 1.0           |
| ------------------- | ------------------------------------------ | ------------------------------------- |
| Anthropic           | `ANTHROPIC_BASE_URL = baseUrl` (`:306`)    | `${baseUrl}/api/services/anthropic`   |
| OpenAI env          | `OPENAI_BASE_URL = ${baseUrl}/v1` (`:314`) | `${baseUrl}/api/services/openai/v1`   |
| Codex `config.toml` | `base_url = "${baseUrl}/v1"` (`:340`)      | `${baseUrl}/api/services/codex/v1`    |
| git `insteadOf`     | `${routerUrl}git/` (`:267`)                | `${baseUrl}/api/services/github/git/` |
| gh REST             | `/api/v3/` (`:206`)                        | unreachable by `gh` — see **G4**      |
| Gemini              | (not wired)                                | `${baseUrl}/api/services/gemini`      |
| Qwen                | (not wired)                                | `${baseUrl}/api/services/qwen/v1`     |

Every row except `gh` is a mechanical substitution. All of them were verified
against a running container rather than read off the route table:
[`data/measurements/router-route-comparison-2026-09-04.md`](data/measurements/router-route-comparison-2026-09-04.md)
probes both images side by side and shows the two dialects are **disjoint** —
every path that answers on `0.119.0` is a `404` on `1.2.0` and vice versa.

This is not a gap in the router. It is a gap in Hive Mind, and it is the whole
of R4's answer. The pin bump and the URL migration are a **single atomic
change**: doing either alone breaks `--use-router`.

### G2 — the router's catalogue is per-account, and that is correct

A live catalogue fetched through the router shows what the router's adopted
subscriptions can reach. `gpt-6-astra` on 2026-09-03 was limited to trusted
partners; `claude-mythos-5-1` is invite-only. An account without those
entitlements will not see them, and **should not**. R1's "support for all new
models" therefore cannot mean "every model in the world is listed as usable".
It means: the bundled table knows the model exists and how to spell it, and the
live catalogue says whether _this_ account can call it. That is the merge R5
describes, and it is why the merge must be labelled rather than flattened.

### G4 — router ≥ 1.0 has no `gh`-reachable REST base (blocking, and the reason the pin cannot simply move)

Issue #2164 gave `--use-router` the ability to mediate `gh` itself: the sidecar
holds the GitHub token, `/etc/hosts` points `api.github.com` at the router, and
the task container never sees a credential. Measurement says that capability
does not survive the pin bump:

| Shape `gh` emits | `0.119.0` | `1.2.0` |
| ---------------- | --------- | ------- |
| `/api/v3/…`      | **401**   | 404     |
| `/api/graphql`   | **401**   | 404     |

On `1.x` the proxy is only mounted under `/api/services/github/api/v3` and
`/api/services/github/api/graphql`. `gh` builds a custom host's REST base as
`https://<host>/api/v3/` and offers **no path-prefix setting** — the router's
own release notes state this twice
(`data/upstream/router-releases-since-0.119.0.md`, lines 1641 and 1649). There
is therefore no client-side configuration, environment variable or `hosts.yml`
key that makes `gh` reach the new prefix.

`git` is unaffected: `url.<prefix>.insteadOf` takes an arbitrary prefix, so
`…/git/` simply becomes `…/api/services/github/git/`.

This is the "if it does not support that mode of operation, we should ensure it
will, by reporting issues on missing features" case R3 names explicitly, and it
is filed as
[link-assistant/router#415](https://github.com/link-assistant/router/issues/415).
The route contract already declares a `ListenerKind::GitHubAdapter`
(`data/upstream/router-route-contract.rs`), but **no `RouteSpec` uses it —
every spec uses `COMBINED_AND_INFERENCE`, `COMBINED_AND_ADMIN` or
`COMBINED_ONLY` — and `router serve --help` exposes no flag that enables it**
(it has `--inference-only`, `--admin-port`, `--admin-host`, `--admin-key`,
`--bridge-model-policy` and nothing else). The hook for exactly this exists and
is unfinished, which is what #415 asks for.

Consequence for the plan: the pin cannot move to `1.x` by default without
silently deleting a shipped isolation feature. Hive Mind must therefore speak
**both** dialects and choose per image, keeping the default pin where `gh`
mediation works until upstream lands a `gh`-reachable base. See R3 + R4 below.

### G3 — three upstream issues, all filed

The `gh` base path in G4 is a genuine missing feature and is reported as
[router#415](https://github.com/link-assistant/router/issues/415). Two smaller
things were reported alongside it, as the issue's rule directs:

1. **A single merged catalogue route** —
   [router#417](https://github.com/link-assistant/router/issues/417). Hive Mind
   must currently fan out to five service-specific routes and normalise three
   different response shapes
   (Anthropic `data[].id` + `max_input_tokens`, OpenAI `data[].id`, Gemini
   `models[].name` + `inputTokenLimit`). A `GET /api/services/models` that
   returns every adopted provider's catalogue in one normalised envelope would
   remove that adapter from every client, not just this one.
2. **Catalogue metadata beyond the ID** —
   [router#418](https://github.com/link-assistant/router/issues/418). The
   Anthropic route can carry `max_input_tokens`, `max_tokens` and
   `capabilities`; the OpenAI route carries little more than the ID. If the
   router surfaced normalised
   context/output/pricing per model, R8's "all other parameters" would be
   satisfiable from the router alone, with models.dev demoted to a true
   last-resort fallback rather than the primary metadata source.

#417 and #418 are enhancements, not blockers; the plan below does not depend on
them, and the normalisation they would remove is implemented downstream in the
meantime. G4/#415 is a blocker for moving the default pin, and the plan below is
shaped around not waiting for it.

---

## Part 4 — Existing components and prior art

The issue asks for a survey of "known existing components/libraries, that solve
similar problem or can help in solutions".

### 4.1 Model-catalogue aggregators

| Component                                          | What it gives                                                                                                            | Verdict for this issue                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **models.dev** `api.json`                          | 213 providers; per-model `limits`, `cost`, `modalities`, `reasoning`, `knowledge`, `release_date`. Already a dependency. | **Keep, as the R8 fallback.** Rich and well-shaped, but 3+ days behind on `gpt-6-astra`. Never the catalogue.                                                                        |
| **OpenRouter** `GET /api/v1/models`                | Unauthenticated; `id`, `context_length`, `pricing`, `supported_parameters`, `architecture`, `benchmarks`.                | **Not adopted.** Same blind spot as models.dev, and its IDs are OpenRouter-namespaced (`anthropic/claude-fable-5.1`), which would need a second mapping layer for no freshness gain. |
| **LiteLLM** `model_prices_and_context_window.json` | `max_input_tokens`, `max_output_tokens`, per-token costs, `supports_*` flags, `deprecation_date`.                        | **Not adopted** as a runtime source, for the same reason. Its `deprecation_date` field is a good idea worth copying into our own metadata shape.                                     |
| **Vendor `GET /v1/models`** (Anthropic, OpenAI)    | Authoritative, current, per-account, and — critically — free.                                                            | **Primary source**, reached through the router.                                                                                                                                      |
| **`codex debug models`**                           | Local, free, no network, 10 models with `slug`/`display_name`/`visibility`/`supported_in_api`.                           | **Primary source for Codex** when no router is running. Already used by `getInstalledCodexModels()`.                                                                                 |

### 4.2 Why not a general HTTP-cache library

`keyv`, `flat-cache`, `cacache` and `make-fetch-happen` all implement TTL'd
persistent caches. None is adopted here: the payloads are three small JSON
documents, the repository already has an atomic, lock-guarded state-file
pattern (§4.3), and `package.json` keeps its dependency surface deliberately
small. Adding a cache library to store three files would be a net loss.

### 4.3 In-repo primitives that the plan reuses

These already exist and are the reason the plan below is mostly wiring:

| Primitive                                                                      | Location                              | Used for                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `resolveBotStateDir()`                                                         | `src/session-store.lib.mjs:65`        | Where the R9 cache file lives.                                                                                   |
| `withStateLock(name, fn)`                                                      | `src/state-lock.lib.mjs`              | `mkdir`-based cross-process lock, with stale-lock breaking, so concurrent `solve` runs cannot corrupt the cache. |
| Atomic write (`.tmp` + `rename`)                                               | `src/agentic-cli-updater.lib.mjs:109` | The exact write pattern for the cache file.                                                                      |
| `readInstalledCliVersion` / `readLatestPublishedVersion` / `installAgenticCli` | `src/agentic-cli-updater.lib.mjs`     | All of R6.                                                                                                       |
| `getInstalledCodexModels()`                                                    | `src/models/index.mjs`                | The token-free Codex source, ready to be promoted from "default picker" to "catalogue source".                   |
| `registerXCommand(bot, sharedCommandOpts)`                                     | `src/telegram-*-command.lib.mjs`      | The R5 command module shape, including the shared `safeReply` / auth / breadcrumb helpers.                       |
| `ROUTER_CREDENTIAL_MOUNTS`, `buildRouterTaskEnv`                               | `src/router-isolation.lib.mjs`        | R3's mounting, already done.                                                                                     |

---

## Part 5 — Solutions and plans, requirement by requirement

### R1 — the new models

Add to `src/models/index.mjs`, with the vendor-quoted specs in
[`data/research/online-research.md`](data/research/online-research.md):

- `claude-fable-5-1` under aliases `fable-5-1`, `claude-fable-5-1`, and — since
  the vendor now lists Fable 5 as legacy and Fable 5.1 as current — repoint the
  bare `fable` alias at it, keeping `fable-5` → `claude-fable-5` for anyone
  pinned. Add to `MODELS_SUPPORTING_1M_CONTEXT`, and to `defaultFallbackModels`
  as `claude-fable-5-1` → `fable-5` → `opus`.
- `claude-mythos-5-1` under `mythos-5-1` / `claude-mythos-5-1`, alongside the
  existing `claude-mythos-5`. Both are invite-only; the live merge (R5) is what
  tells a user whether they can actually call them.
- `gpt-6-astra` under `gpt-6-astra`, plus the `openai.gpt-6-astra` and
  `openai/gpt-6-astra` variants the existing `OPENAI_MODEL_PREFIX_PATTERN`
  handles. Add `gpt-6-astra` → `gpt-5.6-sol` to `defaultFallbackModels.codex`,
  since the model is preview-gated and a fallback is the difference between a
  degraded run and a failed one. Its 1,050,000-token window is **not** recorded
  in `MODELS_SUPPORTING_1M_CONTEXT`: that list exists only to drive the `[1m]`
  suffix, and `supports1mContext` short-circuits on any tool other than
  `claude`, so an entry there would be inert and would imply a `[1m]` suffix
  Codex does not accept. GPT-6 Astra's window belongs to the R8 metadata
  layer instead.
- `gpt-5.6-cyber` and the two Daybreak aliases (`gpt-daybreak-blue-latest`,
  `gpt-daybreak-red-latest`) — the latter two are already advertised by the
  installed Codex CLI, so shipping them costs nothing and closes a real gap.
- Add the new flagships to `primaryModelNames` so `--help` shows them.

Do **not** change `defaultModels` in the same step. `gpt-6-astra` is 2.5× the
price of `gpt-5.6-sol` and preview-gated; making it the default would change
every user's bill without being asked. `claude` stays on `opus` for the same
reason: Fable 5.1 is $10/$50 against Opus 5's $5/$25.

Reproducing test first: a test that asserts `mapModelForTool('claude',
'fable-5-1')` and `mapModelForTool('codex', 'gpt-6-astra')` resolve, which fails
at `e062446e`.

### R2 + R7 + R8 + R9 — the hot-load mechanism

One new module, `src/model-catalogue.lib.mjs`, with a strict source hierarchy
and a hard token-free rule.

**Sources, in order, all free:**

1. **Router** — `GET {routerUrl}/api/services/{anthropic,openai,codex,qwen}/v1/models`
   and `/api/services/gemini/v1beta/models`, with the task's `la_sk_…` bearer
   token. Used when `--use-router` is active or `HIVE_MIND_ROUTER_URL` is set.
2. **Local CLI catalogue** — `codex debug models` for Codex, reusing
   `getInstalledCodexModels()`. Free: it reads the CLI's own compiled catalogue
   and makes no network call.
3. **Direct vendor endpoint** — `GET https://api.anthropic.com/v1/models` when
   an `ANTHROPIC_API_KEY` is present, `GET https://api.openai.com/v1/models`
   when `OPENAI_API_KEY` is. Listing endpoints; no prompt, no `usage`, no bill.
4. **models.dev** — metadata only (R8's explicit fallback), never a source of
   _which models exist_.
5. **Bundled table** — always present, always merged, always labelled.

**The token-free guarantee (R7).** The issue's rule is absolute — "otherwise
such methods must be excluded from our codebase" — so it is enforced
structurally, not by convention:

- Every source is a `{ id, fetch, billable: false }` descriptor, and the merger
  refuses to run a descriptor without `billable === false`.
- A test asserts that no catalogue source issues a request to a completion path
  (`/v1/messages`, `/v1/chat/completions`, `/v1/responses`) or spawns a CLI with
  a prompt argument, by driving each source against a stub transport that throws
  on any such call.
- The "TUI" fallback the issue floats is **explicitly rejected and documented as
  rejected**: driving Claude Code's interactive picker means starting a session,
  and a session is a billable context even when no answer is requested. There is
  no need for it — `GET /v1/models` gives the same list for free.

**Metadata enrichment (R8).** For each merged model, attach in order:
router-reported fields → vendor `/v1/models` fields (`max_input_tokens`,
`max_tokens`, `capabilities`, `created_at`, `display_name`) → models.dev
(`limits`, `cost`, `modalities`, `reasoning`, `knowledge`, `release_date`) →
nothing. Each field records which source it came from. Note the field-name trap
documented in the research notes: the Anthropic Models API has **no**
`context_window` field; the context window is `max_input_tokens`.

**The cache (R9).** `~/.hive-mind/model-catalogue-cache.json`, written
atomically via `.tmp` + `rename` under `withStateLock('model-catalogue', …)`,
one entry per `{source, tool}` with a `fetchedAt` stamp and a **1-hour TTL
floor** (`MODEL_CATALOGUE_TTL_MS = 60 * 60 * 1000`), overridable upward but not
downward by `HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES`. A `--refresh` flag on
`/models` bypasses it for one call. `fetchModelsDevApi()` moves onto the same
cache, which fixes §1.3 for every existing caller at the same time.

**Experimental (R2).** Off unless `HIVE_MIND_MODELS_HOT_LOAD` is set or
`--use-router` is active, and every failure is non-fatal: a source that times
out, 401s, or returns garbage is logged and dropped, and the bundled table
answers alone. Nothing in `solve`'s critical path may be made to depend on a
network call to a preview API.

### R3 + R4 — router pin, routes, and credential adoption

G1 and G4 together decide the shape: the routes must move, but the default pin
must not, because moving it deletes `gh` mediation. So Hive Mind learns **both
dialects** and picks one per image, instead of hard-coding either.

1. A new leaf module `src/router-routes.lib.mjs` holds two frozen route tables —
   `legacy` (`0.x`: `/health`, `/v1`, `/api/v3`, `/git`) and `canonical`
   (`≥ 1.0`: `/api/health`, `/api/management/*`, `/api/services/*`) — plus
   `resolveRouterRouteDialect({ image, env })`, which parses the pinned image
   tag and is overridable with `HIVE_MIND_ROUTER_ROUTES`. Both tables are
   asserted against the measured status codes, so neither can drift silently.
2. Derive every URL from the resolved dialect rather than string-concatenating
   at each call site: `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` (per tool —
   codex, openai, qwen differ), the Codex `config.toml` `base_url`, the git
   `insteadOf`, the gh REST base, and the catalogue paths R2 consumes. Wire
   Gemini and Qwen, which were never wired at all.
3. Point the health check and the token mint/revoke calls at the dialect's
   health and management paths.
4. Call `router auth claude --from-claude-home` and
   `router auth codex --from-codex-home` during sidecar initialization, so R3's
   "initialized" is satisfied and not just "mounted".
5. Let `CODEX_CLIENT_VERSION` reach the sidecar, so the ChatGPT backend does
   not gate the newest models behind a stale client version. Deriving it from
   the locally installed codex CLI (`readInstalledCliVersion` in
   `src/agentic-cli-updater.lib.mjs`) was the first shape of this idea and was
   dropped on inspection: the router's own bundled default already tracks a
   recent Codex CLI, so forwarding whatever happens to be installed here could
   send an **older** version than the router would otherwise claim and re-gate
   the very models this exists to reach. It is therefore a straight
   passthrough — unset means the router's default stands, and an operator who
   needs a specific version sets it.
6. Move the default `ROUTER_SIDECAR_IMAGE` to `0.125.4` — the highest `0.x`
   release, so the legacy dialect and with it the `gh` mediation are kept —
   rather than to `1.x`, and make the image
   selectable with `HIVE_MIND_ROUTER_IMAGE`, so an operator can run `1.2.0`
   today and get the live catalogues, `--pick-model` and the split listeners,
   at the documented cost of `gh` REST/GraphQL mediation (G4).
   `describeRouterCoverageGaps` reports that trade-off per dialect instead of
   leaving it implicit. When upstream lands a `gh`-reachable base, moving the
   default becomes a one-line change with the tests already in place.
7. File the G4 issue upstream, and the two G3 enhancements.
8. Tests in the `tests/test-issue-2164-router-*.mjs` family, asserting the
   built URLs for **both** dialects against the route tables in
   `data/upstream/` and the measured status codes, so the next pin bump fails
   loudly instead of silently.
9. Update `docs/ROUTER.md` (+ `.zh` / `.hi` / `.ru`) — in particular the
   "Model aliases are rejected" limitation, which `--pick-model` and the
   catalogue merge now give a real answer to.

Given the "Claude Code 2.1.255 or newer" floor in the router's own client guide
and the 2.1.251 measured here, R4 and R6 are the same fix seen from two sides.

### R5 — the `/models` command

A new `src/telegram-models-command.lib.mjs` exporting
`registerModelsCommand(bot, sharedCommandOpts)`, following
`telegram-solve-queue-command.lib.mjs` exactly: VERBOSE log → breadcrumb →
`isOldMessage` → `isForwardedOrReply` → `isGroupChat` → `isTopicAuthorized` →
`safeReply`/`safeEditMessageText`, with a "fetching…" placeholder while the
live sources are queried.

Arguments: `--tool claude|codex|agent|opencode|qwen|gemini` (repeatable;
default: every tool), `--refresh` (bypass the cache once), `--all` (include
models the account cannot reach), `--details` (per-model context/output/pricing
from R8).

Output groups models by availability, which is the "fully supported → hot
loaded" spectrum the issue asks for:

- **Bundled + live** — in the installation _and_ confirmed reachable. Fully
  supported.
- **Live only** — hot-loaded; usable now, will be added to the table in a later
  release.
- **Bundled only** — shipped with the installation but not confirmed by any live
  source; may be retired, may be entitlement-gated (`claude-mythos-5`), may
  simply be unverifiable because no live source is configured.

Each line carries its source label and, with `--details`, its metadata and where
that metadata came from. A footer names the sources actually consulted and the
age of the cache, so "why don't I see X" is answerable from the output itself.

A `hive-models` bin exposing the same renderer gives the CLI half; it is added
to `package.json`'s `bin` and `build:pre`.

### R6 — update before listing, update before executing

Reuse `updateAgenticClisWhenIdle()` from `src/agentic-cli-updater.lib.mjs`:

- `/models` and `hive-models` call it, scoped to the tools being listed, before
  querying any source — with `--no-update` to skip.
- `solve` / `task` / `fix` call it for the single tool the run will use, before
  execution starts, honouring the existing 6-hour throttle and the existing
  `HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE` / `_ONLY` / `_EXCLUDE` switches.
- It stays non-fatal: a failed update logs and the run proceeds on the installed
  version. An update mechanism that can block a task is worse than a stale CLI.

### R10 — this document

Delivered by this folder: `data/github/` (the issue and PR feeds),
`data/hive-mind/` (the pinned code state), `data/upstream/` (the router's
release history and route table), `data/measurements/` (six reproducible
measurements), `data/research/` (vendor-quoted specs and citations),
[`MANIFEST.md`](MANIFEST.md) (SHA-256 for every file), and Parts 1–5 above.

---

## Part 6 — Delivery order

Each step is committable on its own and leaves the tree green.

1. This case study (R10).
2. `src/models/index.mjs` — the new models, with a reproducing test (R1).
   The additions pushed the file past the 1350-line early-warning threshold of
   `scripts/check-file-line-limits.sh`, so the bundled catalogue (alias maps,
   defaults, capability lists) moves to a new leaf module
   `src/models/catalog.mjs`, re-exported from `src/models/index.mjs` so the
   public surface is unchanged. This follows the extraction precedent of issue
   #2198 and gives step 3 one obvious thing to merge the live catalogue
   against.
3. `src/router-routes.lib.mjs` + the dual-dialect migration, credential
   adoption and docs (R3, R4). This comes **before** the hot-load mechanism
   because the router is the first and best catalogue source, and R2 needs the
   dialect-aware catalogue paths this step introduces.
4. `src/model-catalogue.lib.mjs` — sources, merge, TTL cache, token-free
   guarantee and its test (R2, R7, R8, R9).
5. `/models` Telegram command and `hive-models` bin (R5).
6. Updater wiring into `/models` and the solve/task/fix paths (R6).
7. Docs (`README.md`, `docs/MODELS.md` + `.zh`/`.hi`/`.ru`), changeset, version
   bump.

## Part 7 — Risks and explicit non-goals

- **Preview-gated models will not appear for most accounts.** By design (G2).
  `/models` says so rather than pretending otherwise.
- **The route migration is the riskiest step.** It changes every URL
  `--use-router` emits. It is gated behind an opt-in experimental flag today,
  which is what makes it acceptable to do in one PR; the per-dialect URL-shape
  tests are what make it reviewable.
- **`gh` mediation and router `1.x` are mutually exclusive today** (G4). The
  default pin stays on `0.x` (at `0.125.4`) for that reason, so nothing that #2164
  shipped is removed. Choosing `1.x` via `HIVE_MIND_ROUTER_IMAGE` is an
  informed trade, reported by `describeRouterCoverageGaps` rather than
  discovered at runtime. This is the one requirement in the issue that cannot
  be fully satisfied from inside this repository; the upstream issue is the
  remedy the issue itself prescribes.
- **Not a goal: changing any default model.** Fable 5.1 and GPT-6 Astra are both
  more expensive than the current defaults and both are, today, gated. They
  become selectable, not automatic.
- **Not a goal: a TUI-driven extraction path.** Rejected under R7 and documented
  as rejected, so a future contributor does not re-derive it.
- **Not a goal: replacing the bundled table.** It is the offline floor and the
  spelling authority. The live catalogue annotates it; it does not supersede it.
