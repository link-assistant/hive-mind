# Docker isolation: allow attaching _additional_ networks (`--network` should be repeatable)

Follow-up to [#154](https://github.com/link-foundation/start/issues/154) / [PR #155](https://github.com/link-foundation/start/pull/155), which shipped in [js-0.31.0](https://github.com/link-foundation/start/releases/tag/js-v0.31.0) and [rust-0.18.0](https://github.com/link-foundation/start/releases/tag/rust-v0.18.0). Thank you — the single-network case works exactly as specified.

The one acceptance item from #154 that did not ship is the multi-network case:

> If multiple networks are supported, create the container on the first network and connect the remaining networks before starting it so the user command cannot race the network setup.

Without it, `--network` cannot express "keep normal connectivity **and** join this private network", which is the shape almost every sidecar use case needs.

## Why the single-network form is not sufficient

`docker run --network <name>` **replaces** the default bridge rather than adding to it. In `js/src/lib/docker-network-options.js` the option is single-valued:

```js
if (arg === '--network') {
  options.network = args[index + 1]; // last one wins; not accumulated
}
```

and `buildDockerRuntimeArgs` (`js/src/lib/isolation.js:522`) emits exactly one `--network`.

So for a task that must reach both the public internet and a private service:

```bash
docker network create --internal my-sidecar-net

# Joins the internal network — and loses its route to github.com / registry.npmjs.org
$ --isolated docker --image node:22 --network my-sidecar-net -- \
    sh -c 'curl -sS -o /dev/null -w "%{http_code}\n" https://api.github.com'
```

The container resolves the sidecar but cannot reach anything outside, because `--internal` networks have no egress and the bridge is gone. Dropping `--network` gives the opposite failure: egress works, the sidecar is unreachable. There is no single-network answer.

## Current downstream workaround

[link-assistant/hive-mind#2146](https://github.com/link-assistant/hive-mind/issues/2146) needs exactly this: an agent task container that talks to a Formal AI sidecar over a private `--internal` network while still pushing to GitHub. It launches the detached session with no `--network`, holds the task behind its own per-session startup gate, and runs

```bash
docker network connect my-sidecar-net "$SESSION_UUID"
```

inside the closed gate before releasing it. That is correct for Hive Mind because the gate already exists for an unrelated reason, but it is downstream lifecycle code that every other caller would have to reinvent, and callers without a gate have a real race: the child command can start before the second network is attached.

## Suggested implementation

Make `--network` repeatable and accumulate into a list, keeping the current behavior for a single value:

- `js/src/lib/docker-network-options.js` — `options.networks.push(value)` instead of `options.network = value`; keep `options.network` as a compatibility accessor for the first entry.
- `js/src/lib/isolation.js` — emit `--network <first>` in `buildDockerRuntimeArgs` as today. For entries 2..n, use `docker create` + `docker network connect` per extra network + `docker start`, so every attachment completes **before** the child command runs. Docker Engine 25+ also accepts repeated `--network` on `docker run`; if a version probe is acceptable, that path is simpler, but the create/connect/start path works on every supported engine.
- `--network-alias` should apply to the network it follows on the command line (`--network a --network-alias x --network b --network-alias y`), which is what `docker network connect --alias` supports natively; if that is too subtle, applying all aliases to the first network and documenting it is acceptable.
- Human-readable isolation status and the JSON execution record should list all networks, not just the first (`isolation.js:552`, `:576`).

## Acceptance tests

- Parser accepts repeated `--network a --network b` and `--network=a --network=b`, and does not consume child-command arguments after `--`.
- `buildDockerRuntimeArgs` emits the first network inline in a stable position; extra networks appear as connect steps, not as extra `--network` flags on the `run` (unless the engine-version path is chosen).
- Integration: create one bridge network and one `--internal` network, launch a container attached to both, and assert **in the same run** that it resolves the sidecar alias _and_ reaches an external host. This is the test that fails today for every possible single-network invocation.
- Detached mode does not release the child command until every requested attachment succeeds; a failure to attach network 2 leaves no orphaned running container and exits non-zero.
- Status output and JSON metadata list all networks and aliases.

## Impact

Not a blocker for Hive Mind — the gate workaround is in production and is described in its case study — but it is the difference between "Docker isolation can express a private sidecar" and "each caller must write container-lifecycle code to express a private sidecar".
