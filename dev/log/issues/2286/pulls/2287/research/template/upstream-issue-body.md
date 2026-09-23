## Summary

The post-publish verifier can report a successful npm publication as failed because its default polling window ends before npm's documented-in-response cache horizon.

At template commit `f2cd4d8623557241fa4127a57a77461751a2f734`, [`DEFAULT_VERIFY_ATTEMPTS` is 7](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/blob/f2cd4d8623557241fa4127a57a77461751a2f734/scripts/publish-retry.mjs#L15). With the current 2-second initial delay and 30-second cap, checks happen after approximately 2, 6, 14, 30, 60, 90, and 120 seconds. The public npm package-metadata response currently advertises `Cache-Control: public, max-age=300`.

This is the same timing defect found while investigating [link-assistant/hive-mind#2286](https://github.com/link-assistant/hive-mind/issues/2286).

## Reproducible evidence

Five recent Hive Mind releases received a successful response from Changesets, but did not appear in public npm metadata until much later:

| Version | Changesets reported success | npm metadata publish time | Delay |
| --- | --- | --- | ---: |
| 2.29.1 | 2026-09-14 18:50:12 UTC | 18:55:21 UTC | 309 s |
| 2.29.2 | 2026-09-15 10:14:54 UTC | 10:18:02 UTC | 188 s |
| 2.29.3 | 2026-09-15 19:40:26 UTC | 19:43:03 UTC | 157 s |
| 2.30.0 | 2026-09-15 21:29:20 UTC | 21:31:58 UTC | 158 s |
| 2.31.0 | 2026-09-21 19:36:53 UTC | 19:41:01 UTC | 248 s |

The Hive verifier used the same backoff parameters but checked immediately first, so it exhausted its seven checks after about 90 seconds. For 2.31.0, [run 35644890960](https://github.com/link-assistant/hive-mind/actions/runs/35644890960) stopped polling at 19:38:25 UTC and failed, although npm subsequently recorded the OIDC-provenanced package with that run's version commit as its `gitHead`.

A deterministic unit reproduction is to make `verify()` return `false` for the first 13 calls and `true` on the 14th while using a no-op `sleepFn`. The default configuration returns a terminal verification failure after call 7 even though no second publish should occur.

## Impact

- A package is available to users, but the release workflow is red (false negative).
- Steps after verification, including GitHub tag/release creation and downstream image publishing, do not run.
- Retrying the publish itself is unsafe because npm has already accepted that immutable version.

## Workaround

After `npm publish` reports success, poll the public registry for at least five minutes without invoking `npm publish` again. A failed workflow can be re-run after the version becomes readable; the existing already-published handling should then enter verification rather than republishing.

## Suggested fix

Extend the default verification deadline to the full five-minute cache horizon (or slightly beyond it). With the existing delays, 13 sleeps total 300 seconds and a 14th gives a margin; a deadline-based loop would make the guarantee clearer. Keep the current separation between publish retries and read-only verification.

Please also add a regression test that proves:

1. verification can succeed at the five-minute boundary;
2. `publish()` is called exactly once after a successful response; and
3. an actually absent version still fails after the bounded deadline.
