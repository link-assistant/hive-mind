# Pull request status (languages: en • [zh](PULL-REQUEST-STATUS.zh.md) • [hi](PULL-REQUEST-STATUS.hi.md) • [ru](PULL-REQUEST-STATUS.ru.md))

A pull request opened by Hive Mind has three states, and only the last one means "you may merge this".

| State                           | What it means                                                                         | What you should do                  |
| ------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- |
| **Draft**                       | Hive Mind is still working: a session is running, or CI/CD is not green yet.          | Wait.                               |
| **Ready for review**            | Hive Mind has verified the mergeable state — in a mergeable mode, this is the signal. | Review.                             |
| **`✅ Ready to merge`** comment | All CI/CD checks pass and there are no merge conflicts.                               | Merge, or let `--auto-merge` do it. |

The pull request body carries a **🚦 How to read this pull request status** notice saying which of the modes below is active, and work-session comments repeat it in one line. If you read only one thing, read that notice: it names the signal to wait for.

> Why this matters: in [`Time0utXC/digitalstructures.pro#4`](https://github.com/Time0utXC/digitalstructures.pro/pull/4) a pull request was merged while the AI was still working on it. The work in progress — and the AI resources spent on it — were lost. See [issue #2246](https://github.com/link-assistant/hive-mind/issues/2246).

## The modes

### `--auto-restart-until-mergeable` (default)

Hive Mind keeps working until the pull request is mergeable: **all** CI/CD checks pass — including the ones that look unrelated to the issue — and the branch has no conflicts with its base. The pull request stays a draft for that entire time. When the mergeable state is verified, Hive Mind takes it out of draft itself and posts a `## ✅ Ready to merge` comment. That comment is your green light; the merge is yours to perform.

### `--auto-merge`

The same, and then Hive Mind merges the pull request for you. Implies `--auto-restart-until-mergeable`.

### `--no-auto-restart-until-mergeable`

One working session, no CI/CD monitoring afterwards. The pull request is a draft while the session runs and is marked ready for review when it ends — **CI/CD may still be running or failing at that point**, and no `✅ Ready to merge` comment is posted. Here, "ready for review" means exactly that: review it.

## Who owns the draft flag

Hive Mind does, not the AI worker.

- The pull request is created with `gh pr create --draft`, and the state is then **read back** — a repository that does not allow draft pull requests silently ignores the flag, so the pull request is converted explicitly if it came out ready for review.
- Every working session converts the pull request to draft when it starts.
- In a mergeable mode the ready-for-review transition is **held back** until the mergeable state is verified. If the AI worker, or a human, takes the pull request out of draft mid-run, Hive Mind puts it back and logs `⏸️ PR stays draft`.
- A finished run never leaves a pull request in draft. On every exit path — normal end, `CTRL+C`, or a fatal error — the hold is released and the pull request is marked ready for review.

The tool prompts say all of this to the AI worker as well, in a single line: there is no need for it to change the pull request state manually, the state is handled by the Hive Mind system, and the goal of its work is a _mergeable_ pull request — every failing check is its problem, even one that looks unrelated to the issue it was given.

## Reading a state you did not expect

| What you see                                         | What it means                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Draft, and the last comment is a session-end comment | A session finished; in a mergeable mode Hive Mind is now watching CI/CD. The comment says so.                                                    |
| Ready for review, no `✅ Ready to merge` comment     | Either the run is in `--no-auto-restart-until-mergeable` mode, or the monitoring stopped — a stop comment explains why (timeout, billing limit). |
| `⏸️ PR stays draft` in the log                       | Something asked for ready-for-review while the hold was engaged; the draft was re-asserted.                                                      |
| `✅ Ready to merge`, then new commits                | Someone pushed after the verification. The next monitoring check re-verifies and the pull request can return to work.                            |

## Related

- [CONFIGURATION.md](./CONFIGURATION.md#solve-options) — every flag named here
- [CI-CD-BEST-PRACTICES.md](./CI-CD-BEST-PRACTICES.md) — what "all checks pass" requires from the repository
