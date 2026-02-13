---
'@link-assistant/hive-mind': minor
---

Add Kilo Gateway free models support for --tool agent

This release adds support for 6 free models from Kilo Gateway:

- `kilo/glm-5-free` - Z.AI flagship model (free for limited time)
- `kilo/glm-4.7-free` - Z.AI agent-centric model
- `kilo/kimi-k2.5-free` - MoonshotAI agentic model
- `kilo/minimax-m2.1-free` - MiniMax general-purpose model
- `kilo/giga-potato-free` - Evaluation model
- `kilo/trinity-large-preview` - Arcee AI preview model

Short aliases are also supported (e.g., `glm-5-free`, `kilo-glm-4.7-free`).

Usage:

```bash
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
```

See docs/FREE_MODELS.md for comprehensive documentation.

Fixes #1282
