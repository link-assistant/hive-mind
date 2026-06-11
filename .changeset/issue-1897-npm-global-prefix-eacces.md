---
'@link-assistant/hive-mind': patch
---

fix(install): redirect npm global prefix when root-owned to avoid EACCES at startup (#1897)

`use-m` loads runtime dependencies (command-stream, getenv, yargs, …) by shelling
out to `npm install -g <alias>@npm:<pkg>@latest`, which installs into the global
prefix reported by `npm root -g`. When the CLI was launched under a system-wide
Node.js whose global `node_modules` is owned by root (e.g.
`/opt/node-v24.16.0-linux-x64/lib/node_modules`), that install failed with
`npm error code EACCES … rename … command-stream-v-latest` and the whole process
crashed at the very first `use()` call (`Error: Failed to install
command-stream@latest globally.`). This commonly happens when hive-mind was
installed with `bun add -g` (user-owned `~/.bun/...`) but invoked under a system
Node whose global prefix needs root.

The new `src/npm-global-prefix.lib.mjs` preflight mirrors npm's own documented
EACCES remedy: before any `use-m` bootstrap runs, it detects a non-writable npm
global prefix and redirects `npm_config_prefix` (honoured by both `npm install -g`
and `npm root -g`) to a user-writable `~/.npm-global`, prepending its `bin` to
`PATH`. The common case where the prefix is already writable stays a no-op with
no extra `npm` spawn. It is wired into the `solve`, `hive` and `review` entry
points ahead of their use-m calls, skips Windows' different global layout, and
respects an explicitly preset `npm_config_prefix`.
