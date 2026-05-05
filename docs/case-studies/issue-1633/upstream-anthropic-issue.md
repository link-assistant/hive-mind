# Bun global install leaves `claude` wrapper without native binary because postinstall is blocked

## Summary

Installing `@anthropic-ai/claude-code` globally with Bun can appear to succeed but leaves a non-working `claude` command because Bun blocks dependency lifecycle scripts such as `postinstall` by default.

This is probably expected from Bun's security model, but the current Claude Code fallback error does not mention Bun or the `Blocked 1 postinstall` clue, so users may not understand why the package manager reported success while `claude --version` fails.

## Reproduction

Environment:

- Linux x64
- Bun 1.3.11
- Claude Code 2.1.113

Use an isolated home so the repro does not depend on an existing install:

```sh
rm -rf /tmp/claude-bun-home
mkdir -p /tmp/claude-bun-home

HOME=/tmp/claude-bun-home \
BUN_INSTALL=/tmp/claude-bun-home/.bun \
bun install -g @anthropic-ai/claude-code@2.1.113

HOME=/tmp/claude-bun-home \
BUN_INSTALL=/tmp/claude-bun-home/.bun \
PATH=/tmp/claude-bun-home/.bun/bin:$PATH \
claude --version
```

Observed install output:

```text
bun add v1.3.11 (af24e281)
installed @anthropic-ai/claude-code@2.1.113 with binaries:
 - claude

Blocked 1 postinstall. Run `bun pm -g untrusted` for details.
```

Observed `claude --version` output:

```text
Error: claude native binary not installed.

Either postinstall did not run (--ignore-scripts, some pnpm configs)
or the platform-native optional dependency was not downloaded
(--omit=optional).
```

## Workaround

Use the native installer:

```sh
curl -fsSL https://claude.ai/install.sh | bash
claude --version
```

In the same isolated environment, that installed and verified `2.1.113 (Claude Code)` successfully.

## Suggested fix

The install docs already recommend the native installer, and Bun's behavior is intentional. The actionable improvement would be to update the fallback error text and/or troubleshooting docs to explicitly mention Bun, for example:

```text
If you installed with Bun, Bun may have blocked the postinstall script.
Use the native installer, install with npm, or explicitly trust/run the
Claude Code postinstall in Bun.
```

That would make the root cause clear when Bun exits successfully but reports `Blocked 1 postinstall`.

## Related downstream report

This was found while fixing https://github.com/link-assistant/hive-mind/issues/1633.
