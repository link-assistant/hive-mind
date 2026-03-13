---
'@link-assistant/hive-mind': patch
---

fix: hide cancel button and show cancelling state on /merge cancel (Issue #1407)

When user clicked the "🛑 Cancel" button during `/merge` queue processing, the cancel button remained visible in the Telegram message until the current PR finished processing (potentially hours if waiting for CI). The toast message "The current PR will finish processing" was also confusing.

The fix immediately hides the cancel button by editing the message without `reply_markup`, shows a "🛑 Cancelling..." indicator in the progress message when cancellation is requested, and adds `isCancelled` support to `waitForCI()` for early exit when the operation is cancelled.
