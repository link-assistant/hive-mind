- https://github.com/link-assistant/agent/pull/323#issuecomment-5896427734
- https://gist.githubusercontent.com/konard/6734dd6dd7f871aeab52725b3e440421/raw/e1af6d1e2643452d8d9efd2c348fe32ece413ecd/tmp-hive-mind-log-upload-N8APcJ-sanitized.log.txt
- https://github.com/link-assistant/agent/pull/323#issuecomment-5896435509
- https://github.com/link-assistant/agent/pull/323#issuecomment-5896436158

I never asked to kill the AI session on repeated tool calls, AI was waiting for CI/CD checks, and that must be working. We must never interfere with legitimate tool calls. We must disable `repeated tool call` tool call detection by default, and set it by default from 3 to 10 attempts.

It is surely will damage workflows of codex and claude, and may be others, for now we can disable it globally by default, and only enable if option provided.

Here we failed to check the description of the issue and it left the pull request unattached to issue, which should never happen even if something fails.

Also is something fails it is critical at all places to have full log attached:

https://github.com/konard/p-vs-np/pull/623#issuecomment-5897797370
https://github.com/konard/p-vs-np/pull/623#issuecomment-5897808960 (here I see full log, but no correct attachment of pull request to the issue).

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.

