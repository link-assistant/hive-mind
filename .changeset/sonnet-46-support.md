---
'@link-assistant/hive-mind': minor
---

Add support for Claude Sonnet 4.6 and set it as the default model for `--tool claude`

- Added `claude-sonnet-4-6` as the new default model when using `sonnet` alias
- Added `sonnet-4-6` short alias for explicit Sonnet 4.6 selection
- Added backward compatibility aliases: `sonnet-4-5` and `claude-sonnet-4-5` for Sonnet 4.5
- Added 1M token context window support for Sonnet 4.6 (`sonnet[1m]`, `sonnet-4-6[1m]`)
- Maintained full backward compatibility with previous model versions
