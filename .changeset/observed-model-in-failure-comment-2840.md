---
'@link-assistant/hive-mind': patch
---

Name the model that actually ran in failure comments and choose the fallback
from it. Claude's `system/init` and assistant `message.model` IDs are recorded
as the stream arrives, so a session that crashed, was killed or ended with an
error before its `result` event still reports `claude-opus-5-5` instead of the
bundled alias mapping. When no actual model is known the comment says
"Requested (actual model unknown — session ended before result)" instead of
presenting the alias mapping as the model. The `opus` alias now maps to
`claude-opus-5-5`, so the default fallback is `opus-5` instead of skipping to
`opus-4-8`.
