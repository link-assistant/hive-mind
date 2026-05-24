# Upstream issue draft for `cli/cli` (gh)

This is the text drafted (to be) submitted to the official GitHub CLI
repository. Keep it self-contained — the maintainers cannot see our
case study.

---

## Title

`gh api` and `gh graphql` have no default network timeout and no
`--timeout` flag, allowing requests to hang indefinitely

## Versions

- Reproduced on `gh` 2.74.x family (latest stable at filing time).
- Source: `cli/cli` `trunk` — relevant file is
  `pkg/cmd/api/api.go` (uses the default `api.NewHTTPClient`).

## Summary

`gh api` (and `gh graphql`) construct an HTTP client without setting
`http.Client.Timeout`. Go's zero default is "no timeout", which means
that under certain network conditions — a TCP half-open connection, a
load-balancer holding a socket without responding, a server that
accepts the connection and then never writes a byte — `gh` will block
forever on `(*Response).Body.Read`. There is no `--timeout` flag on
`gh api`/`gh graphql`, no `gh config set` key for network timeout, and
no documented way to make this fail loudly.

Downstream tooling that wraps `gh` therefore has to either:

1. Manage `gh` lifetime externally (timer + `SIGTERM`), which is
   what we've added in our wrapper (`link-assistant/hive-mind` PR
   #1812), or
2. Accept that `gh api` can hang their own process indefinitely.

Adding a sane default plus a flag/config knob would let consumers
configure the behavior properly and would make `gh` safer to use in
unattended pipelines (CI, automation, monitoring loops).

## Reproduction

```bash
# Terminal 1: accept the TCP connection but never send anything.
ncat -l 12345 --keep-open --send-only </dev/null

# Terminal 2: force gh to hit that listener instead of api.github.com.
#   (We override the hostname via DNS or hosts file; here we use a
#    Python TCP forwarder for portability.)
python3 - <<'PY' &
import socket, threading
def fwd(a, b):
    while True:
        d = a.recv(4096)
        if not d: break
        b.sendall(d)
def serve(port, target):
    s = socket.socket()
    s.bind(('127.0.0.1', port)); s.listen(8)
    while True:
        c, _ = s.accept()
        u = socket.socket(); u.connect(target)
        threading.Thread(target=fwd, args=(c,u), daemon=True).start()
        threading.Thread(target=fwd, args=(u,c), daemon=True).start()
serve(8443, ('127.0.0.1', 12345))
PY

# Now point gh at the silent listener.
GH_HOST=api.local.test gh api user
# … hangs forever; no timeout, no error.
```

Expected: `gh api user` fails after a small bounded delay (e.g. 30 s)
with a clear error like:

```
gh: request to https://api.local.test/user timed out after 30s
```

Actual: `gh api user` hangs until the process is killed by an external
signal.

## Suggested fix

1. Set a default `http.Client.Timeout` on the client built in
   `api.NewHTTPClient` (e.g. 60 s for `api`, 120 s for `graphql`, or a
   single shared default).
2. Add a `--timeout <duration>` flag to `gh api` and `gh graphql`
   accepting Go duration syntax (`30s`, `2m`, `0` to disable).
3. Add a `network.timeout` key to `gh config` so the flag can be set
   globally (mirrors `http.proxy` / `http_unix_socket` etc.).
4. Document the new default and overrides in `gh-api(1)` /
   `gh-graphql(1)`.

A more surgical alternative (if changing the default risks user
compatibility): keep the default at "no timeout" but add the flag and
config key in step 2/3 so consumers can opt in. We'd prefer step 1
plus 2 plus 3, because the silent-hang-by-default is a real footgun
for unattended use.

## Workaround applied in our wrapper

While the upstream lands, our wrapper at
[`link-assistant/hive-mind`](https://github.com/link-assistant/hive-mind)
adds a `timeoutMs` option to its `ghWithRateLimitRetry` helper.
Internally it uses an `AbortController` wired into `command-stream`'s
`signal` option so the spawned `gh` is SIGTERMed cleanly when the
timeout fires. PR with the workaround:
<https://github.com/link-assistant/hive-mind/pull/1812>.

## Additional impact

Any unattended consumer (CI, monitoring, automation frameworks,
desktop tooling) that shells out to `gh api`/`gh graphql` is affected.
Common consequences:

- Long-lived CI jobs that hang past their job-timeout, wasting runner
  minutes.
- Tools that batch many `gh` calls and stall the entire batch on a
  single slow request.
- Headless solve agents (like ours) where a hung `gh` call masquerades
  as a long-running model call.

A bounded default timeout plus an opt-out makes `gh` safer to embed
across all of those use cases.

Thanks for the great CLI — happy to follow up with a PR if it would
help.
