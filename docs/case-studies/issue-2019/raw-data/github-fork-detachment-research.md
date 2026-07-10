# GitHub fork detachment research (issue #2019 follow-up)

This file captures the external research used to answer the follow-up question in
Hive Mind issue #2019:

> User confessed, that he made repository private, and after that public again.
> Is it possible to recover https://github.com/konard/Payel-git-ol-Octra as fork
> again without deletion of repository?

## What GitHub does on a visibility change

GitHub's documentation "What happens to forks when a repository is deleted or
changes visibility" states that changing visibility detaches forks from the
network:

- When a public repository is made private, its public forks are split off into
  a new network and become detached from the original repository.
- Private forks remain private but become disconnected from the original
  repository.
- Making the repository public again does **not** reconnect the previously
  detached forks. "Any new changes made to these networks will not be accessible
  from the original repository that was made public."

Community and docs guidance is consistent that "leaving the fork network is
permanent and the new repository cannot be reconnected to the fork network"
through any self-service UI or API.

## Can the fork relationship be recovered without deletion?

There is **no API or self-service UI** to re-attach a detached fork. The only
non-deletion path is a **GitHub Support request**:

- Open <https://support.github.com/request/fork>.
- Use the "Attach, detach or reroute forks" flow.
- Ask GitHub Support to re-attach `konard/Payel-git-ol-Octra` to
  `Payel-git-ol/Octra`.

GitHub documents visibility-change detachment as permanent, so reattachment is
requested through Support and is not guaranteed.

## Why this matters for Hive Mind

While a repository is detached from the upstream network, it **cannot open a
cross-repository pull request** to the upstream repository, because GitHub only
allows cross-repo PRs within the same fork network. That is exactly why Hive
Mind's fork-replacement path wants to delete and re-fork: a detached repository
cannot serve as a PR head for `Payel-git-ol/Octra`.

So the recovery options are:

1. Ask GitHub Support to re-attach the fork (keeps the repository, keeps the 3
   unique branch commits, restores cross-repo PR capability) — not guaranteed.
2. Back up the 3 unique branch commits, delete the repository, and let Hive Mind
   create a fresh fork.

The safety stop in issue #2019 was therefore a **true positive**: deleting the
repository without backing up those 3 branch commits would have lost them.

## Sources

- <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/what-happens-to-forks-when-a-repository-is-deleted-or-changes-visibility>
- <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/detaching-a-fork>
- <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-permissions-and-visibility-of-forks>
- <https://support.github.com/request/fork>
- <https://github.com/orgs/community/discussions/148998> (Fork rerouting)
