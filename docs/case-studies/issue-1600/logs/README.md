# Logs Archive

Raw logs for issue #1600 are committed to this directory so calculation logic can be verified against them.

## Sources

| Local file | Size | Source |
| --- | ---: | --- |
| `doublets-rs-pr-48-claude-code.log` | 14,321,843 bytes | [gist c3f793ac3675f7c1c47cc107aa56dc91](https://gist.github.com/konard/c3f793ac3675f7c1c47cc107aa56dc91) |
| `web-capture-pr-55-claude-code.log` | 1,941,786 bytes | [gist 4283918f2e241ec25aaf37e5019c679d](https://gist.github.com/konard/4283918f2e241ec25aaf37e5019c679d) |
| `hive-mind-pr-1621-claude-code.log` | 2,828,019 bytes | [gist 0abcb130318ea732df9d570cde202cdb](https://gist.github.com/konard/0abcb130318ea732df9d570cde202cdb) |
| `hive-mind-pr-1615-codex-initial.log` | 7,185,779 bytes | [gist e698faf4461aafb4678d3152cc5c6ca6](https://gist.github.com/konard/e698faf4461aafb4678d3152cc5c6ca6) |
| `hive-mind-pr-1615-codex-auto-restart-1.log` | 11,870,428 bytes | [gist 35fc26cc6d1039a1b4d89be6a5423201](https://gist.github.com/konard/35fc26cc6d1039a1b4d89be6a5423201) |
| `hive-mind-pr-1615-codex-auto-merge-1.log` | 15,938,506 bytes | [gist 657796d22e693b524aaba572e5fba5aa](https://gist.github.com/konard/657796d22e693b524aaba572e5fba5aa) |

## Key Codex Evidence

The PR #1615 Codex verbose logs showed usage events with `input_tokens`, `cached_input_tokens`, and `output_tokens`. No cache write field was observed, so the fixed GitHub comment formatter must not print `0 cache write` for that case.
