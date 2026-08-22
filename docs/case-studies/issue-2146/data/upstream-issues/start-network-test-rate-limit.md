# The multi-network integration test probes `https://api.github.com`, so it fails under GitHub API rate limiting and blocks the js release

Published as [link-foundation/start#160](https://github.com/link-foundation/start/issues/160).

---

## Summary

The integration test added in #157 asserts internet egress by fetching `https://api.github.com` with BusyBox `wget --spider`. That endpoint is rate limited per source IP for unauthenticated callers, and GitHub Actions runners share IP pools, so the request regularly answers `403 rate limit exceeded`. BusyBox `wget` treats a 403 as a failure, the probe container exits `1`, and the assertion on the container exit code fails.

This is not a hypothetical: it is what happened on `main` immediately after #157 merged. `Rust CI/CD` published `rust-v0.19.0`, but [`JavaScript CI/CD` run 31380353470](https://github.com/link-foundation/start/actions/runs/31380353470) failed on `Test (Bun on ubuntu-latest)`, so the `Release` job was skipped and **no `js-v0.32.0` was published**. `npm view start-command version` still reports `0.31.0`, which means the repeatable `--network` support that #156 asked for is unreachable from the JavaScript package even though the code is merged.

The same probe string is used by the Rust test (`rust/tests/docker_network.rs:80`), so the Rust release pipeline carries the identical failure mode and passed only by luck of the rate-limit window.

## Failure

`js/test/docker-network-integration.js:57` — _reaches a private sidecar and the internet through two networks_:

```
$ ping -c 1 formal-ai && wget -q --spider https://api.github.com

76 |     assert.strictEqual(joinedExit.status, 0, joinedExit.stderr);
77 |     assert.strictEqual(joinedExit.stdout.trim(), '0');
                 ^
AssertionError: Expected values to be strictly equal:

'1' !== '0'

      at /home/runner/work/start/start/js/test/docker-network-integration.js:77:12
(fail) Docker named network integration > reaches a private sidecar and the internet through two networks [395.11ms]
```

The assertion only reports the exit code, not the container output, so the message gives no hint about which half of the `&&` failed. That is a second, smaller problem — see the last section.

## Reproduction

This reproduces the failure exactly, without Bun and without the test harness, on any host whose IP has spent its unauthenticated GitHub API quota:

```bash
docker network create --internal start-probe-net
docker run -d --name start-probe-sidecar \
  --network start-probe-net --network-alias formal-ai alpine:3.23 sleep 60

docker create --name start-probe-joined --network bridge alpine:3.23 \
  sh -c 'ping -c 1 formal-ai && wget -q --spider https://api.github.com'
docker network connect start-probe-net start-probe-joined
docker start start-probe-joined
docker wait start-probe-joined     # -> 1
docker logs start-probe-joined
```

Observed:

```text
PING formal-ai (172.19.0.2): 56 data bytes
64 bytes from 172.19.0.2: seq=0 ttl=64 time=0.488 ms

--- formal-ai ping statistics ---
1 packets transmitted, 1 packets received, 0% packet loss
round-trip min/avg/max = 0.488/0.488/0.488 ms
wget: server returned error: HTTP/1.1 403 rate limit exceeded
```

The multi-network feature itself is correct. The private alias resolves over the `--internal` network and the bridge default route is preserved — both halves of what #156 asked for are working. Only the choice of probe URL is wrong.

## Root cause

`https://api.github.com` answers `403 rate limit exceeded` to unauthenticated callers who have exhausted the 60 requests/hour budget for their source IP. A GitHub Actions runner does not have a dedicated IP; the budget is effectively shared across everything else running on that pool at the same moment. So the probe is a coin flip whose result has nothing to do with the code under test.

`wget --spider` exits non-zero on any HTTP status ≥ 400, so a rate-limit answer — which is itself proof that DNS, routing and TLS all worked — is reported as "no internet".

## Proposed fix

Probe a host that does not rate limit anonymous callers. Verified locally against the same reproduction, exit code `0`:

```diff
-      'ping -c 1 formal-ai && wget -q --spider https://api.github.com',
+      'ping -c 1 formal-ai && wget -q --spider https://example.com',
```

in both places:

- `js/test/docker-network-integration.js:63`
- `rust/tests/docker_network.rs:80`

`example.com` is reserved by RFC 2606 for exactly this use, is served by an anycast CDN, and returns `200` to anonymous callers. Any equivalent unmetered endpoint works; the requirement is only that a healthy network cannot produce a ≥ 400 status.

Two optional hardening steps, both cheap:

1. **Report the container output on failure.** `assert.strictEqual(joinedExit.stdout.trim(), '0')` currently prints `'1' !== '0'` and nothing else, which is why this took a local reproduction to diagnose rather than a log read. Passing `docker(['logs', connected]).stdout` as the assertion message would have named the failing half immediately.
2. **Separate the two claims.** `ping -c 1 formal-ai && wget …` conflates "the private network is attached" with "the default bridge survived". Two containers, or two sequential commands with distinct exit codes, would let a failure say which invariant broke.

## Acceptance test

`js/test/docker-network-integration.js` passes on a runner whose GitHub API quota is exhausted. Concretely, this should hold:

```bash
# burn the anonymous quota first, then run the suite
for i in $(seq 1 70); do curl -s -o /dev/null https://api.github.com/rate_limit; done
bun test js/test/docker-network-integration.js
```

## Impact

`js-v0.32.0` is not published, so downstream JavaScript consumers cannot use the feature delivered for #156. [link-assistant/hive-mind#2147](https://github.com/link-assistant/hive-mind/pull/2147) pins `start-command@0.31.0` from npm and needs the repeatable `--network` to attach a task container to both the default bridge and a private Formal AI sidecar network in one launch; until the release exists, that repository has to keep its own `docker network connect` step inside a start gate.

## Environment

- Failing run: <https://github.com/link-foundation/start/actions/runs/31380353470>, job `Test (Bun on ubuntu-latest)`, 2026-08-10T10:44:03Z
- Reproduced on: Linux 6.8.0-137-generic, Docker Engine (default bridge), `alpine:3.23` (`sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40`)
- `npm view start-command version` → `0.31.0` (latest published), while `rust-v0.19.0` is released
