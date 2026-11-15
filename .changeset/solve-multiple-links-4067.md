---
'@link-assistant/hive-mind': minor
---

`/solve`, `/claude`, `/codex` and the other solve aliases now start every GitHub issue or pull request link when the command replies to a message with several links, instead of refusing with `Found N GitHub links in the message` (issue #4067).

- Each valid link starts as its own task, as if the command had been sent once per link with the same options. Each "Starting…" or "Queued…" message replies to the same command message.
- Links start one at a time, with a random 10–15 second pause between two starts.
- Links that cannot be started (not an issue or pull request link, not found, already running or queued, rejected by the queue) get one summary after every valid link has started.
- A repository link in a list is not started (it would solve the whole repository); the summary says to send `/solve <repository-url>` alone for that.
- An error in the options is answered once, and nothing starts. `/stop` during a batch stops the links not yet started.
- Duplicated links start once. Captions and hidden (`text_link`) links of the replied message are read too.
- A command can also list several links itself: `/solve <url-1> <url-2> --model opus`.
- A reply to a message with a single link works as before.
