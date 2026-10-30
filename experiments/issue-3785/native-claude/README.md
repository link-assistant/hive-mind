# Native Claude credential and refresh experiment

This exercises the actual pinned Linux 2.1.310 executable, without changing its
code. The release image installs this version using the official installer.
Locally inspected binary SHA-256:
`b73676430af12f97316a798b8371f81d640f90a58bdcb8f3ce56a835bb47df56`.

The fixture supplies only disposable synthetic credentials. Its HTTP proxy binds
to loopback and never forwards traffic. For the native HTTPS OAuth endpoint, it
terminates the client's CONNECT tunnel using a temporary certificate trusted
only by that child through `NODE_EXTRA_CA_CERTS`. TLS verification stays enabled.
Only the two expected vendor CONNECT origins are accepted; the model endpoint is
another route on the same loopback fixture. No real provider receives a request.
The fixture uses Python's standard library, OpenSSL and util-linux `prlimit`.

All native children get separate private home/configuration directories and the
same `CLAUDE_SECURESTORAGE_CONFIG_DIR`. Native process groups are always stopped
and reaped before temporary state is removed. Each child has a 1 GiB data limit,
16 MiB stack, disabled core dumps and bounded diagnostic files. Request controls
have 20-second deadlines; abandoned-lock recovery has a 90-second deadline.

## Verified host controls

```sh
node experiments/issue-3785/probe-claude-secure-storage.mjs /absolute/path/to/claude
python3 experiments/issue-3785/probe-claude-native-refresh.py /absolute/path/to/claude \
  --diagnostics /tmp/claude-healthy-native.log
for scenario in expired concurrent replace-login logout; do
  python3 experiments/issue-3785/probe-claude-native-refresh.py /absolute/path/to/claude \
    "--$scenario" --diagnostics "/tmp/claude-$scenario-native.log"
done
```

- Native status and logout use the independent credential root without changing
  conflicting private/default stores. Explicitly empty selector semantics remain
  distinct from an unset selector.
- A healthy native request performs zero refreshes and uses synthetic G0.
- An expired native request exchanges G0 once, publishes canonical G1, and uses G1.
- Two concurrent native processes with different private configurations share the
  lock: one exchange, two actual model requests, both using G1.
- Atomic replacement with a fresh G2 login while the G0 response is paused
  preserves G2 and executes using G2.
- Logout during that pause does not recreate credentials or execute a model
  request.

The synthetic model returns an error after recording admission. These checks
establish native request authorization and writer behavior, not successful model
completion or conversation lifecycle. Local structural logs are retained in
`docs/case-studies/issue-3785/evidence/claude-native-refresh-controls.log`.
The new native Claude workflow repeats the controls with an independently
installed exact version and preserves its digest/diagnostics; fresh CI is pending.

## Unresolved native owner death

```sh
python3 experiments/issue-3785/probe-claude-native-refresh.py /absolute/path/to/claude \
  --owner-death --expect-predecessor-reuse --diagnostics /tmp/claude-owner-native.log
python3 experiments/issue-3785/probe-claude-native-refresh.py /absolute/path/to/claude \
  --owner-death --diagnostics /tmp/claude-owner-strict-native.log
```

The mock consumes G0, then holds its response. The owning process group is killed
and reaped. A second actual CLI reclaims the abandoned lock and exchanges the same
G0. The first command confirms this defect; the second is the strict failing
regression. The mock rejects the duplicate with `invalid_grant`. There are two
refresh requests and zero model requests. This result does not establish the live
provider's grace-window or replay behavior.

Canonical uncertainty needs durable intent or a documented provider replay
contract. The retained workflow explicitly expects the existing defect; a passing
experiment job must not be presented as a repaired crash criterion. Production
mounts remain unchanged. Native login, all other credential backends/writers,
cross-container PID/mount namespace recovery, complete history, root/two-task
lifecycle and release/deployment integration are still unfinished.

## Completed native conversation and fresh-peer resume

The same fixture's `--history` mode returns a valid synthetic Anthropic SSE
completion. It projects only `projects/` and `sessions/` into otherwise separate
private configuration directories. The first actual CLI completes and writes a
native transcript, then its entire process group is reaped and both private
home/configuration directories are deleted. A fresh peer resumes the session
using the native `--resume` command. Its next model request contains the first
user message, and the canonical transcript still contains it. Both requests use
canonical G0 and perform zero refreshes.

```sh
# Private-history disposal is a negative control, not a startup failure.
python3 experiments/issue-3785/probe-claude-native-refresh.py /absolute/path/to/claude \
  --history --private-history --expect-history-gap --diagnostics /tmp/claude-history-before.log
# The strict resume regression must fail with private history.
python3 experiments/issue-3785/probe-claude-native-refresh.py /absolute/path/to/claude \
  --history --private-history --diagnostics /tmp/claude-history-strict.log
# Actual successful completion and resume with the shared directories.
python3 experiments/issue-3785/probe-claude-native-refresh.py /absolute/path/to/claude \
  --history --diagnostics /tmp/claude-history-after.log
```

The negative control specifically requires native `No conversation found with
session ID` and zero additional model requests. It cannot pass on an arbitrary
startup error. Results are retained in
`docs/case-studies/issue-3785/evidence/claude-native-history-controls.log`.
The test uses real filesystem directory links in one host namespace; it does not
attest Docker mounts, all indexes/archives, concurrent writers, other projects,
provider backends, deployment migration or production scope overrides. Those
criteria remain open. The dedicated native workflow repeats these controls.
