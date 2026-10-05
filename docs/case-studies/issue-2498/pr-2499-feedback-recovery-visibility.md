Source: https://github.com/link-assistant/hive-mind/pull/2499#issuecomment-6001743889
Created: 2026-10-05T19:43:32Z

Update all dependencies to the latest versions including https://github.com/link-foundation/start, also double check that we clearly make it visible on GitHub and Telegram that our task was restarted and actively worked on, as I sometimes see now on previous version that after restart there is exactly no commits, no comments for a long time, so we show that it recovered and restarted, but still failed. And if it failed after restart why we showed comment with failure before recovery? And if it failed and stopped, how it could be recovered?

We need to double check everything again, make sure we will have enough diagnostics in telegram bot and in the log produced by start-command, so in all cases our logs will reflect entire sequence of events and all user facing output will be provided clearly with no misleading to the user.

If something is not yet done in start repository report all the issues.
