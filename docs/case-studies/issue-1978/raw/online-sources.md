# Online Source Notes

Issue: https://github.com/link-assistant/hive-mind/issues/1978

Research date: 2026-06-25

## Official Claude Code Documentation

- Environment variables: https://code.claude.com/docs/en/env-vars
  - Environment variables can control Claude Code behavior including model selection.
  - When the same behavior has an environment variable and a settings field, the environment variable takes precedence.
  - Interaction with CLI flags varies by feature; `--model` and `/model` override `ANTHROPIC_MODEL`.

- Model configuration: https://code.claude.com/docs/en/model-config
  - The alias environment variables must be full model names, or equivalent provider model IDs.
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL` controls the model for `haiku` and background functionality.
  - `CLAUDE_CODE_SUBAGENT_MODEL` controls the model for all subagents and agent teams.
  - `CLAUDE_CODE_SUBAGENT_MODEL` overrides per-invocation model parameters and subagent `model` frontmatter.
  - `CLAUDE_CODE_SUBAGENT_MODEL=inherit` restores normal Claude Code subagent model resolution.
  - `ANTHROPIC_SMALL_FAST_MODEL` is deprecated in favor of `ANTHROPIC_DEFAULT_HAIKU_MODEL`.

- CLI reference: https://code.claude.com/docs/en/cli-reference
  - `claude --help` does not list every flag, so absence from help is not definitive.
  - `--model` sets the model for the current/main Claude session and overrides `ANTHROPIC_MODEL`.
  - No separate `--sub-agent-model` Claude CLI flag is documented in the CLI reference.
