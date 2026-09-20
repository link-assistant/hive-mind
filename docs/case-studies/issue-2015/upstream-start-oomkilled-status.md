# `$ --status` can remain `executing` while `oomKilled=true` for detached docker sessions

## Summary

Downstream `link-assistant/hive-mind` issue
https://github.com/link-assistant/hive-mind/issues/2015 found two detached
Docker sessions where `$ --status` exposed `oomKilled true` but still reported
the primary status as `executing`.

Hive Mind can work around this by treating `oomKilled true` as terminal, but
the status contract would be safer if start-command made the session terminal
when Docker reports the container was OOM-killed.

## Related upstream work

This is related to, but narrower than, closed issue
https://github.com/link-foundation/start/issues/144. Issue 144 requested
surfacing Docker resource-exhaustion markers. The remaining gap is that the
marker is visible while the top-level status can still remain `executing`.

## Observed examples

Example 1 from downstream issue #2015:

```text
sessionId 58ab247d-595e-4c7a-a2b5-0dffe839a2e7
internal session 1e9e7513-edd7-43a2-b143-169cfd794af6
status executing
oomKilled true
isolated docker
```

Example 2:

```text
sessionId 526880a3-a1fc-45cf-8880-87d0a0d913f2
internal session d90880d4-aa05-4145-ac02-7542eea2041a
status executing
oomKilled true
isolated docker
```

The preserved start-command logs for both sessions did not contain normal
`Finished` / `Exit Code` footers, so downstream consumers only had the status
payload and Docker OOM marker to classify the result.

## Expected behavior

When Docker reports `State.OOMKilled=true`, `$ --status` should return a
terminal session state. The exact status label can follow start-command naming,
but downstream tools need these invariants:

- top-level status is no longer `executing`;
- exit code is Docker's real exit code when known, otherwise 137 is a reasonable
  OOM/SIGKILL fallback;
- `endTime` or equivalent completion metadata is set when available;
- `oomKilled true` remains present in structured and links-notation output.

## Downstream impact

Without this, consumers have to special-case `oomKilled true` ahead of the
primary status. Hive Mind's Telegram monitor had two bad outcomes:

- one OOM-killed session was reported with confusing killed copy while status
  still said executing;
- another OOM-killed session stayed visually stuck as executing.

Hive Mind PR https://github.com/link-assistant/hive-mind/pull/2016 adds the
downstream workaround and regression tests.

## References

- Downstream issue: https://github.com/link-assistant/hive-mind/issues/2015
- Downstream PR: https://github.com/link-assistant/hive-mind/pull/2016
- Related upstream issue: https://github.com/link-foundation/start/issues/144
- Docker Engine API reference for `State.OOMKilled`:
  https://docs.docker.com/reference/api/engine/version/v1.45/
