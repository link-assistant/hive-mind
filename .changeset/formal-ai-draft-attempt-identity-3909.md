---
'@link-assistant/hive-mind': patch
---

Formal AI drafts opened from issues now run the Formal AI source selected at admission instead of the backend baked into the Hive Mind image (#3909). A `select` job resolves the Formal AI `main` head (or a release, or a pinned replay) and the Hive Mind commit once and records an immutable attempt identity; a `binary` job obtains that exact commit's binary from a release whose native receipt names it, or builds it fresh; the `draft` job verifies the binary digest, the image (pinned by digest and bound to the Hive Mind source) and the actual serving process before any task effect. A missing artefact is a distinct "Formal AI draft deferred" outcome and a wrong one an "identity mismatch", never a fallback to an older image or `latest`. Live-current, published-release and historical-replay attempts are labelled separately, retries keep one identity, and the health report counts deferred attempts.
