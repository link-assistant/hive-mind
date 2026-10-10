---
'@link-assistant/hive-mind': patch
---

Support the obvious "latest version" alias of every model family (issue #2591): `--model astra` now resolves to the newest GPT Astra and `sol` to GPT-6.1 Sol. The aliases (`astra`/`sol`/`luna`/`terra`/`daybreak-*` for codex, `opus`/`sonnet`/`haiku`/`fable`/`mythos` and `opus-5.5`-style spellings for claude, `max`/`plus`/`flash` for qwen) are derived from model names, including those the installed Codex CLI reports, so new families need no code change. The "Available models" listings now show what each CLI currently offers instead of obsolete and `openai.`-prefixed entries (codex: 62 → 13). Gemini uses its CLI's rolling `flash`/`pro`/`auto` aliases, Qwen accepts `coder-model`, agent and opencode map premium aliases to the newest Claude and Gemini models, and opencode defaults to `big-pickle` because `grok-code` is deprecated. Set `HIVE_MIND_MODEL_DEBUG=1` (or `--verbose`) to trace how a `--model` value was resolved.
