---
'@link-assistant/hive-mind': patch
---

Keep hive user's home directory clean

- Move Go GOPATH from `~/go` to `~/.go/path` to keep everything under the hidden `.go` directory
- Move Perlbrew from `~/perl5` to `~/.perl5` (hidden directory)
- Remove automatic cloning of hive-mind repository to `~/hive-mind`

This keeps the user's home directory empty by default, giving users freedom to organize their workspace as they prefer.

Fixes #1004
