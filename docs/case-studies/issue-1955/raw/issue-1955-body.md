https://github.com/link-assistant/formal-ai/pull/536#issuecomment-4754207791

https://raw.githubusercontent.com/konard/public-logs/main/log-tmp-solution-draft-log-pr-1781897288930.txt/tmp-solution-draft-log-pr-1781897288930.txt

If that is network issue, we can just retry the same session using resume for codex. If that other root cause, we should find it out and fix it.

We also need to check for other network related issues usually found with codex from GitHub and so on, and support them all with auto-retry.

Also 429, timeouts and so on. Everything that is 100% temporary should be retriable (except of 5 hour and 7 days limits), like we do with `--tool claude`.

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.
