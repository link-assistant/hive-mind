---
'@link-assistant/hive-mind': minor
---

Add configurable experiments/examples folder paths with ability to disable

New CLI options for both `solve` and `hive` commands:

- `--prompt-experiments-folder <path>`: Path to experiments folder used in system prompt. Set to empty string to disable experiments folder prompt. Default: `./experiments`
- `--prompt-examples-folder <path>`: Path to examples folder used in system prompt. Set to empty string to disable examples folder prompt. Default: `./examples`

Features:

- Backwards compatible: defaults to `./experiments` and `./examples` as before
- Custom paths: Specify custom folder paths for experiments and examples
- Disable functionality: Set to empty string (`''`) to disable the experiments/examples prompt section entirely
- Works with all AI tools: claude, opencode, codex, and agent
