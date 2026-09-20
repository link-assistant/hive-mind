https://github.com/G-Ivan-A/mango_ba_prompts/issues/141#issuecomment-4757598725

What is the exact root cause? And what user or system administrator should do in such cases?

We usually give concrete instructions on any error, here is not the case, also the error message should be written in such a way that the root cause is easy to understand.

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.