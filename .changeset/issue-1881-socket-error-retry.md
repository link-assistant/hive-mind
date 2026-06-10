---
'@link-assistant/hive-mind': patch
---

fix(retry): treat "socket connection was closed unexpectedly" as a transient, retryable error (#1881)

The Claude/Codex CLI surfaces transient network disconnects (the Anthropic SDK's
underlying `fetch()` socket dropping mid-stream) as a synthetic error:
`API Error: The socket connection was closed unexpectedly.` Previously
`classifyRetryableError()` did not recognise this family of errors, so a single
dropped socket aborted the entire solve session (exit code 1, zero retries) and
discarded all in-progress work. These socket/connection drops
(`socket connection was closed unexpectedly`, `socket hang up`, `ECONNRESET`,
`connection reset`, `Connection error`, `fetch failed`, `network connection lost`)
are now classified as retryable, so the session is retried with `--resume`
(context preserved) via the existing exponential-backoff path. Because
`classifyRetryableError` is the shared classifier, the fix covers the Claude,
Codex and Agent execution loops at once.
