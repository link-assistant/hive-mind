# Agent #322: prepare the bash parser while OpenTUI remains blocked

Checked on 2026-09-30. This work addresses Agent's parser migration; it does not
complete [Agent #322](https://github.com/link-assistant/agent/issues/322).

## Upstream blocker

The latest `@opentui/core` and `@opentui/solid` releases are 0.5.13. Core still
declares `web-tree-sitter: "0.25.10"` as an exact peer and its published worker
still resolves `web-tree-sitter/tree-sitter.wasm`. The latest `web-tree-sitter`,
0.27.0, exports `web-tree-sitter/web-tree-sitter.wasm` instead.

The [upstream maintainer's response](https://github.com/anomalyco/opentui/issues/1201#issuecomment-4806912949)
confirms that 0.26+ has additional breaking changes and is unsupported. The
[proposed filename fallback](https://github.com/anomalyco/opentui/pull/1203)
was closed without merging. Changing only Agent's WASM path cannot fix OpenTUI's
worker or peer contract. Keep the exact 0.25.10 dependency and the open #322 URL
in `dependencyPins`; #322 must stay open until a compatible upstream release
passes the full acceptance criteria.

Check the published metadata again with:

```sh
npm view @opentui/core version peerDependencies --json --prefer-online
npm view @opentui/solid version peerDependencies --json --prefer-online
npm view web-tree-sitter version exports --json --prefer-online
```

## Reproduction and regression coverage

From the repository root:

```sh
bun experiments/issue-322/verify-bash-parser.mjs
```

The script packs the current source into temporary packages with 0.25.10 and
0.27.0, installs each in a fresh Bun project, checks its peers with `npm ls`, and
runs `js/tests/tool_bash.js` against the installed package. Only the temporary
package's `web-tree-sitter` declaration changes. It leaves the repository's pin
and lockfiles untouched and removes the temporary projects on exit. The same
script runs in the Ubuntu unit test job.

Before the parser change, the three functional tests passed with 0.25.10 and
failed with 0.27.0 because the old WASM export could not be resolved. After the
change, both versions initialize and execute the allowed command. Both versions
also reject a denied command in a shell chain and in a command substitution
before creating the target file. No AI credentials or network model calls are
needed; package installation requires registry access.

The production 0.25.10 package installs without incorrect-peer warnings and
`npm ls web-tree-sitter --all` succeeds. The experimental 0.27.0 package still
warns about the OpenTUI peer and `npm ls` reports `ELSPROBLEMS`. Those failures are
expected evidence of the remaining blocker, not a claim of OpenTUI compatibility.

## Remaining acceptance criteria

1. Upgrade to an OpenTUI release that explicitly supports the current parser
   runtime and verify its worker initializes and renders highlighted content.
2. Upgrade Agent's direct dependency and refresh both lockfiles; remove the
   freshness exception only once the upgrade is valid.
3. Rerun the bash tool tests and install the production packed package in a fresh
   Bun project without any peer warnings or `npm ls` errors.
