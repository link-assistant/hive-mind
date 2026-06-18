---
'@link-assistant/hive-mind': patch
---

Stop surfacing meaningless stream fragments as tool errors (#1941). When a tool
run is interrupted mid-stream (CTRL+C / SIGINT, exit code 130), the last captured
stdout line could be a stray structural character such as a lone `}`, which leaked
into the GitHub failure comment as "CLAUDE execution failed with }". A new shared
`isMeaningfulErrorText` helper (any error with at least one Unicode letter or digit
is real; pure punctuation is not) now guards the `extractToolErrorCore` chokepoint,
and a new `buildToolErrorMessage` helper labels interruptions explicitly
("Claude command interrupted (CTRL+C)") across the Claude and OpenCode runners.
