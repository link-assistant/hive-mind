# Issue #4143: no way to ask a bot whether tasks are running

Opened by konard on 2026-11-25T12:56:23Z. Downloaded with `gh issue view 4143` and `gh api .../issues/4143/comments`.

**Problem.** An operator, or an automated redeploy, cannot ask a running
`hive-telegram-bot` whether it is idle.

- The queue lives in memory.
- Isolated tasks show up as containers with the label `start-command.uuid`
  (`src/hive-manager/task/lifecycle.mjs:21`).
- A task without isolation shows up only as a `solve`/`hive` process inside
  the bot container.
- A redeploy therefore has to guess from `docker ps` and `docker top`, and
  queued but not yet started work is invisible.

**Ask.** A read-only status for the instance with:

- the running tasks (isolated or not) and the queued tasks;
- whether intake is paused;
- for example `hive-telegram-bot --status --json`, or a file the bot keeps
  current under `~/.hive-mind`.

A "drain" mode would also help: stop taking new tasks and finish the running
ones, so that a redeploy can wait for idle.

**Workaround downstream.** A script that counts running, restarting or paused
`start-command.uuid` containers, and `solve|hive|task|review|fix` processes
in `docker top` of the bot.

---

Sources checked: hive-mind `45c85a4`, hive-mind-control-center `9eab30b`. Found while automating a safe redeploy of a Hive Mind bot with Ansible.

## Comment (2026-11-25T13:55:06Z, konard)

We can use .lino file in the application folder that should be mounted to the host system so our management tools have access to current state of the queue, and if our system restarts we still have access to the queue, and can do autorecovery and so on, and keep updating statues of telegram messages.

We also should use binary file saved via https://github.com/link-foundation/link-cli, so we can for now have 2 storages - binary and text storage, and they should agree, we also should use transaction file enabled in link-cli, so we can also auto-recover the storage.

If any bugs or missing features at https://github.com/link-foundation/link-cli or https://github.com/link-foundation/links-notation or https://github.com/link-foundation/lino-objects-codec we should report issues to these repositories.

We also need to double check that link-cli supports concurrent access to the same binary files from multiple link-cli instances, with lock attached to process id, so if process is dead the lock is automatically released or something like that, multiple different ways of making locks must be configurable in link-cli.

So the most safe way to access up and running bot is via the data storage which should store most of its state, which should also be recoverable on restart, so if docker container restarted users notice nothing, and everything continue to work as before.

We also can use that database to store subscription settings like users that subscribed to notifications in private messages and so on, all the feature we have should be fully supported in our link-cli (binary) and .lino (text).

So we get data from link-cli, and if it agrees with .lino it is safe read, if it does not we retry few times, until it is in sync.

Bot has responsibility of keeping link-cli and .lino in sync, but we don't expect that to be immediate, so bot must first write to .lino file, after that to link-cli.

We also should prefer indented/nested version of links notation with minimized parentheses by default.

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.
