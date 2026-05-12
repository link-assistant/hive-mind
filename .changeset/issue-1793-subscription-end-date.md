---
"@link-assistant/hive-mind": patch
---

Show subscription end date in `/limits` for Claude and Codex when the underlying providers expose it. Claude trials display the trial end date from the OAuth profile; Codex displays the renewal date decoded from the ChatGPT JWT (`chatgpt_subscription_active_until`). Lines are only rendered when real data is available.
