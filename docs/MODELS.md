# Models: the live catalogue, `/models`, and `hive-models` (languages: en • [zh](MODELS.zh.md) • [hi](MODELS.hi.md) • [ru](MODELS.ru.md))

A model that a provider released this morning is useless to you if Hive Mind
only knows the list it was published with. This page describes how Hive Mind
finds out what exists **right now**, how to ask it, and the one rule the whole
mechanism is built around: **listing models must never cost you a token.**

> **⚠️ EXPERIMENTAL.** The live sources are new (issue
> [#2202](https://github.com/link-assistant/hive-mind/issues/2202)). The bundled
> catalogue is not: it is the same list Hive Mind has always validated
> `--model` against, and it remains the answer when every live source is
> unreachable. Nothing here can make a run fail — a source that errors is
> reported and skipped.

## Ask what is available

```bash
# Every tool, using cached answers.
hive-models

# Just Codex.
hive-models --tool codex

# Claude, with context windows, pricing and provenance, ignoring the cache.
hive-models --tool claude --details --refresh

# Machine-readable.
hive-models --json | jq '.tools.claude.liveOnly'
```

In Telegram the same listing is `/models`, and it takes the same arguments in a
forgiving form — `/models --tool codex`, `/models --tool=codex` and `/models
codex` all mean the same thing, because a chat is not a shell:

```
/models
/models codex --details
/models --all
```

`/models` answers for `claude` unless you say otherwise; `--all` sends one
message per tool.

## Reading the answer

```
Models for claude (default: opus)
3 bundled and live · 2 hot loaded · 14 bundled only

Bundled and live (3) — shipped with this installation and confirmed reachable now
  * claude-opus-5 (opus, opus-5) [1M ctx · 128K out · $5/$25 per Mtok · reasoning · text+image+pdf · 2026-07-24]
    claude-sonnet-5 (sonnet, sonnet-5)
    ...

Hot loaded (2) — a live source has them, this installation does not ship them
    claude-fable-5-2
    ...

Bundled only (14) — shipped, but no live source confirmed them
    ...

Sources, in the order they are trusted:
  - Link.Assistant Router: ok — 41 model(s)
  - Anthropic GET /v1/models: skipped — ANTHROPIC_API_KEY is not set
  - models.dev: ok — specifications for 3570 model(s)
  - Bundled with this installation: ok — 17 model(s)

Live answers are cached for 1h 0m; pass --refresh to ignore the cache.
```

The three groups are the point of the command:

| Group                | Means                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Bundled and live** | Ships here **and** a live source confirms it. Safe to use.                                                                |
| **Hot loaded**       | A live source has it, this installation does not ship it. Usable now.                                                     |
| **Bundled only**     | Ships here, but no live source confirmed it — expired, renamed, or your account is not entitled to it. It may still work. |

`*` marks the default model for that tool. Names in parentheses are aliases you
can pass to `--model`. `--details` adds the specifications and the sources each
model came from.

When `HIVE_MIND_MODELS_HOT_LOAD=0`, the third group is titled simply **Bundled**
— with no live source consulted, calling it "unconfirmed" would be an accusation
the command cannot support.

## Where the list comes from

Sources are tried in this order, and the same order is the precedence when two
of them describe the same model:

| #   | Source                         | Contributes  | Why it is trusted where it is                                                                                            |
| --- | ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Link.Assistant Router          | availability | The gateway a routed task actually talks to. Only it can say a model is reachable _through the path the task will take_. |
| 2   | `codex debug models`           | availability | The installed Codex binary answering from its own catalogue — no network call, and authoritative about what it accepts.  |
| 3   | Anthropic `GET /v1/models`     | availability | What this API key is entitled to.                                                                                        |
| 4   | OpenAI `GET /v1/models`        | availability | Same shape, same reasoning.                                                                                              |
| 5   | models.dev                     | metadata     | Context windows, pricing, modalities, release dates. It **never** adds a model to the available list — it annotates one. |
| 6   | Bundled with this installation | availability | `src/models/catalog.mjs`. Always present; the answer when everything else is unreachable.                                |

The router source is only consulted when a router is already reachable or can be
started locally; an operator-run router (`HIVE_MIND_ROUTER_URL`) is used but
never started or stopped by this command. See [Router isolation](./ROUTER.md).

## Listing models never costs a token

Issue #2202 states it as a hard constraint: _"models extraction should never
trigger any tokens expense, otherwise such methods must be excluded from our
codebase."_ That is a property of the **sources**, so it is enforced where a
source is declared rather than trusted at each call site
(`src/model-catalogue-sources.lib.mjs`). Two redundant guards:

1. **`assertTokenFreeSource`** rejects any source that has not explicitly
   declared `billable: false`. A source cannot become billable by omission.
2. **`assertTokenFreeUrl`** rejects any URL whose path is a completion endpoint,
   whatever descriptor it arrived under. A typo turning `/v1/models` into
   `/v1/messages` throws instead of spending.

The other half of the rule is a record of what was **not** implemented, so
"we don't do that" is reviewable rather than merely absent:

| Rejected method                                         | Why                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drive the Claude Code TUI `/model` picker               | Starting the TUI starts a session, and Claude Code sends a request at session start. The cost is real and invisible, and it lands on someone else's bill.        |
| Drive the Codex TUI `/model` picker                     | `codex debug models` returns the same catalogue as JSON with no network call, so the TUI adds cost and flakiness for nothing.                                    |
| Probe a completion endpoint to see whether an id exists | One token is still a billed request, and a 404 for an unknown model is indistinguishable from a 404 for an unentitled one. `assertTokenFreeUrl` refuses the URL. |
| Scrape vendor documentation HTML                        | Free, but unversioned and layout-dependent. models.dev aggregates the same specifications behind a stable JSON contract.                                         |

## Caching

Live answers are cached **for at least an hour**, per source and per tool, in
the Hive Mind state directory. `HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES` can only
ever _raise_ that floor: a shorter lifetime would ask providers more often,
which is the thing the cache exists to prevent. `--refresh` (and `/models
--refresh`) ignores the cache for one run without changing the stored TTL.

A source that fails is not fatal and does not poison the cache — the last good
answer is reused and marked `stale`, and the failure is printed in the source
list so you can see _why_ the catalogue looks the way it does.

## Keeping the CLIs current

A stale `claude` or `codex` binary is the usual reason a brand-new model name is
rejected, so the commands that drive one check for a newer version first:
`/solve`, `/hive`, `/task`, `/fix` (through the `/solve` child it starts),
`hive-models` and `/models`.

The check is deliberately timid:

- **Throttled** to once every 6 hours, and state-locked so concurrent runs do
  not fight.
- **Deferred while other tasks are running.** A CLI is never swapped out from
  under someone else's solve. Each run excludes its _own_ task from that
  test — the gate detects busy tasks by scanning process command lines, and
  would otherwise find the very run asking the question and defer forever.
- **Narrowed** to the CLI the command is about to drive. Listing Codex models
  does not reinstall Gemini.
- **Never fatal.** A registry outage costs you nothing but the update.
- **Skipped entirely** for `--dry-run` / `--only-prepare-command`, which must
  not install anything.

Turn it off per run with `--no-tool-update`, or globally with
`HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE=0`.

## Configuration

| Variable                                | Meaning                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_MODELS_HOT_LOAD=0`           | Do not consult live sources at all; list only the bundled catalogue                                              |
| `HIVE_MIND_MODELS_ROUTER=0`             | Skip the router source specifically, keeping the other live sources                                              |
| `HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES` | Raise the cache lifetime above the 60 minute floor                                                               |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`   | Enable the corresponding provider listing endpoint. Absent is not an error — the source is skipped               |
| `HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE=0`   | Never check the agentic CLIs for a newer version                                                                 |
| `HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY`     | Comma-separated allow-list of CLIs the updater may touch                                                         |
| `HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE`  | Comma-separated deny-list. A command's own narrowing **intersects** with these — it cannot override an exclusion |

## See also

- [Router isolation](./ROUTER.md) — the gateway the first source reads from
- [Configuration](./CONFIGURATION.md) — every `--model` and `--tool` option
- [Free models](./FREE_MODELS.md) — which of these cost nothing to run
- [Case study: issue #2202](./case-studies/issue-2202/README.md) — the measurements and reasoning behind this design
