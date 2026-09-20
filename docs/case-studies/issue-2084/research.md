# Issue #2084 — verified upstream mechanics

Sources: `openai/codex` Rust source, `openai/plugins`, `obra/superpowers`, and
local reproduction against Codex CLI 0.144.6. Claims are marked where they are
inference rather than something read from source or observed directly.

## `codex plugin` CLI

Exactly four subcommands: `add`, `list`, `marketplace`, `remove`. There is no
`install`, no `validate`, no `show`. `--available` is only valid together with
`--json`.

`codex plugin list --json` returns `{ "installed": [...], "available": [...] }`.
Each entry carries `pluginId`, `name`, `marketplaceName`, `version`,
`installed`, `enabled`, `source`, `marketplaceSource`, `installPolicy`,
`authPolicy`. Without `--available` the `available` array is empty.

There is no command that answers "can the model see this skill". That gap is
why issue #2084 was possible.

## `CODEX_HOME` layout

| Path                                              | Contents                                                  |
| ------------------------------------------------- | --------------------------------------------------------- |
| `config.toml`                                     | `[marketplaces.<name>]`, `[plugins."<id>"]`, `[features]` |
| `.tmp/plugins`                                    | curated marketplace snapshot                              |
| `.tmp/plugins.sha`, `.tmp/plugins.sync.lock`      | snapshot sync bookkeeping                                 |
| `plugins/cache/<marketplace>/<plugin>/<version>/` | **installed plugin payload, including `skills/`**         |
| `skills/<name>/SKILL.md`                          | user skills (deprecated location, still read)             |
| `skills/.system/`                                 | embedded system skills                                    |

## `CODEX_HOME` does not relocate every skill root

In `core-skills/src/loader.rs`, `skill_roots_from_layer_stack_inner` pushes
`config_folder.join("skills")` — which follows `CODEX_HOME` — and then
`home_dir.join(".agents").join("skills")`, which is joined onto `$HOME`.

So `$HOME/.agents/skills` is read regardless of `CODEX_HOME`. Isolating that
root requires overriding `HOME` as well. Hive Mind's repository-scoped state
therefore isolates plugin state but not operator-installed user skills.

## Skills are context, not a tool

`core-skills/src/render.rs` builds the model-visible catalog;
`core-skills/src/injection.rs` injects a full `SKILL.md` body when a skill is
invoked. No feature flag gates user or plugin skills — `bundled_skills_enabled`
gates only the embedded system skills.

`[features] multi_agent = true` is unrelated to skill exposure. Per
superpowers' own `references/codex-tools.md` it enables `spawn_agent`,
`wait_agent` and `close_agent`, which some superpowers skills need in order to
_run_. It is not what makes them _visible_.

## `request_plugin_install` and `<recommended_plugins>`

The tool description restricts the model to ids from a supplied list. That list
is built by `core-plugins/src/remote.rs::fetch_recommended_plugins`, which
calls `GET {chatgpt_base_url}/ps/plugins/suggested?scope=GLOBAL` after
`ensure_chatgpt_auth(auth)?`. API-key users get nothing, so the allowlist is
empty and every `plugin_id` is rejected. Not locally configurable.

The handler also contains an explicit error path,
`"plugin install requests are not available in codex-tui yet"`.

## Marketplaces

Reserved names include `openai-curated` (local snapshot, populated by a git
sync of `https://github.com/openai/plugins.git`), `openai-curated-remote`
(ChatGPT-backed), `openai-api-curated`, `openai-bundled`,
`created-by-me-remote`, `workspace-directory`.

Attempting `codex plugin marketplace add` with a manifest that names itself
`openai-curated` fails with `marketplace 'openai-curated' is reserved and
cannot be added from this source` — observed directly while building the
reproduction.

`codex plugin add` installs from an on-disk snapshot and is a local operation;
populating the curated snapshot requires network. _(Inference from code
structure; the offline boundary was not exhaustively tested.)_

## `superpowers` in the curated marketplace

`openai/plugins` contains ~180 plugins; `superpowers` is one of them. Its
vendored manifest declares `"version": "5.1.3"` and `"skills": "./skills/"`,
and it ships 14 skills including all six the issue mandated. The upstream
`obra/superpowers` repository declares `"version": "6.1.1"` with the same
`"skills": "./skills/"`.

The official install path documented in the superpowers README is the
interactive `/plugins` TUI flow, not a shell command. `codex plugin add
superpowers@openai-curated` is the non-interactive equivalent _(inference; not
documented upstream)_.

## Corrections to earlier assumptions

- `https://github.com/obra/superpowers/blob/main/.codex/INSTALL.md` does not
  exist (404). There is no `.codex/` directory in that repository.
- `codex plugin install --non-interactive`, cited by third-party blog posts, is
  not a real subcommand.
- Cloning superpowers and symlinking it into `~/.agents/skills` is not an
  official install method.
- `openai/codex-plugins` is not a real repository; the curated marketplace is
  `openai/plugins`.

## Upstream observations worth reporting

Two findings are upstream-facing rather than Hive Mind bugs. Neither has been
filed yet:

1. **`codex plugin list` can report `installed, enabled` for a plugin whose
   skills the model cannot see.** A `codex plugin doctor`, or a `skillCount` in
   the `--json` output, would make this diagnosable without probing the
   rendered prompt.
2. **`request_plugin_install` fails identically for "no allowlist available"
   and "id not in allowlist."** An agent operating under an API key cannot tell
   that the mechanism is unavailable rather than that it guessed wrong, and the
   failure costs a full run.
