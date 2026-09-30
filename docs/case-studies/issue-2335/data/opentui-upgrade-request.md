The investigation of [hive-mind #2335](https://github.com/link-assistant/hive-mind/issues/2335) and [agent #322](https://github.com/link-assistant/agent/issues/322) confirms that the remaining work is a deliberate compatibility upgrade, as explained in [#1201](https://github.com/anomalyco/opentui/issues/1201#issuecomment-4806912949). This is a feature request for tracking that upgrade, rather than reopening the unsupported configuration bug or assuming that a WASM filename fallback establishes compatibility.

Reproduction of the current dependency constraint:

```json
{
  "name": "opentui-peer-reproduction",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@opentui/core": "0.5.13",
    "web-tree-sitter": "0.27.0"
  }
}
```

Run `npm install --package-lock-only --ignore-scripts --strict-peer-deps --no-audit --no-fund`. npm exits with `ERESOLVE unable to resolve dependency tree`: OpenTUI declares the exact `web-tree-sitter@0.25.10` peer. Replacing `0.27.0` with `0.25.10` succeeds. Our metadata-only reproduction ran with Node 24.21.0/npm 12.0.2; the successful control also warned about OpenTUI's Node >=26.4.0 engine requirement. This reproduction does not claim to test rendering or the new runtime API.

Workaround: retain the supported `web-tree-sitter@0.25.10` pin. Forcing the peer resolution or trying both filenames is not evidence that the new runtime works with OpenTUI. Agent already added parser-local support for both WASM names in [PR #326](https://github.com/link-assistant/agent/pull/326), while retaining the pin and documenting the OpenTUI blocker.

Suggested implementation and acceptance criteria:

- Upgrade the worker/client integration deliberately for the current web-tree-sitter API and its exported `web-tree-sitter.wasm` asset, then update the peer range to versions verified by integration tests.
- Cover worker initialization, grammar loading, parsing, markdown concealment/rendering, bundled assets, and the supported Node/Bun runtime matrix. If retaining 0.25 compatibility, run the same tests against both supported versions.
- Verify a packed consumer installation with strict peer checking and the upgraded direct dependency, without peer-resolution warnings.
- Keep initialization failures visible so consumers can distinguish unsupported runtimes from successful highlighting.

Evidence and the reusable reproduction script are in [hive-mind PR #2336](https://github.com/link-assistant/hive-mind/pull/2336), under `docs/case-studies/issue-2335` and `examples/issue-2335-opentui-peer-compatibility.mjs`. The related issue search found #1201 and no open request tracking this deliberate dependency upgrade.
