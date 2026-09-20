# Follow-up Improvements

- Convert more Telegram messages to explicit safe send/edit helpers where they still use direct Telegram calls for formatted content.
- Add a small integration-style test that runs representative Telegram command output for every supported locale and checks for known English UI-label leaks.
- Consider exposing locale-aware reset formatting from `limits-i18n.lib.mjs` as the only reset-time API, so new `/limits` sections do not accidentally reintroduce English date strings.
- Add a developer note for the local Node version mismatch. The package currently requires Node `>=24.0.0`, while this workspace only had Node v20.20.2 available.
- If Telegram formatting errors keep appearing, log a compact message fingerprint in verbose mode so repeated failures can be grouped without dumping full message bodies by default.
