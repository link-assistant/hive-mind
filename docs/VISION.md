# Hive Mind: Vision (languages: en • [zh](VISION.zh.md) • [hi](VISION.hi.md) • [ru](VISION.ru.md))

This document explains **what pain Hive Mind solves, for whom, and where it is
going**. If [FEATURES.md](./FEATURES.md) answers _"what can it do?"_ and
[flow.md](./flow.md) answers _"how does it work?"_, this document answers _"why
does it exist, and what does a day with it actually look like?"_

To make the value concrete, the largest part of this document is a catalogue of
**user journeys** — short, realistic stories that walk from a real problem to a
delivered result. They are split into journeys we **support today** and journeys
we **want to support in the future**.

## Table of Contents

1. [The Pain](#the-pain)
2. [The Vision](#the-vision)
3. [Guiding Principles](#guiding-principles)
4. [Who It Is For](#who-it-is-for)
5. [User Journeys We Support Today](#user-journeys-we-support-today)
6. [User Journeys We Want to Support](#user-journeys-we-want-to-support-future)
7. [How Journeys Map to the Pain](#how-journeys-map-to-the-pain)
8. [Where to Go Next](#where-to-go-next)

## The Pain

Software teams and solo developers share a set of recurring frustrations. Hive
Mind exists to remove them.

- **Endless backlogs of small-but-real work.** Bug reports, flaky tests,
  outdated docs, dependency bumps, small refactors, "good first issues" — each
  is individually cheap but collectively never-ending. They starve more
  important work and rarely get done.
- **Babysitting AI tools.** Most AI coding assistants stop every few seconds to
  ask for permission, run only while you watch, and lose all context the moment
  you close the editor. You become a supervisor of the AI instead of a reviewer
  of its results.
- **Unsafe local execution.** Giving an AI full freedom on your developer
  machine risks your tokens, your files, and your production systems. Fully
  sandboxed alternatives are safe but too limited to install packages, browse docs, or
  configure a real environment.
- **Context switching kills flow.** A two-hour interruption to fix a small issue
  costs far more than two hours once you account for losing focus on the work
  that actually matters.
- **You are tied to a computer.** Triggering, steering, and reviewing AI work
  usually requires SSH access, a terminal, and an IDE — so nothing happens while
  you are away from your desk.
- **Work does not scale.** When ten issues land at once, a single human (or a
  single AI chat session) processes them one at a time. There is no easy way to
  spin up "a team" on demand.
- **Tokens wasted on plumbing.** AI budget burns on routine git operations,
  branch creation, and PR boilerplate instead of on actually solving the
  problem.

The common thread: **the routine parts of software work consume the time,
attention, and money that should go to the creative parts.**

## The Vision

> **Hive Mind is a master-mind AI that orchestrates a hive of AI workers — and,
> when needed, collective human intelligence — to clear the routine work of
> software so that human attention is reserved for decisions that truly need
> it.**

We believe the right division of labour is:

- **AI does the routine work** — reading the codebase, writing the change,
  creating the branch and the pull request, iterating until checks pass.
- **Humans make the decisions** — defining the problem, answering questions when
  requirements are unclear, and deciding what gets merged.
- **Automation does the plumbing** — git, forking, PR creation, session
  recovery, and orchestration are handled in code, so AI tokens and human
  attention both stay focused on the creative core.

The end state we are building toward: you describe a problem from any device,
sleep, and wake up to a reviewable draft pull request — or to a thoughtful
question if the problem was under-specified. Scale that from one issue to an
entire backlog, and from one worker to a coordinated swarm.

## Guiding Principles

These principles explain the trade-offs Hive Mind deliberately makes.

1. **Autonomy over babysitting.** Workers run in full autonomous mode. The human
   touch points are the start (the issue) and the end (the review), not every
   command in between.
2. **Isolation over local risk.** Workers run in disposable VMs or Docker
   containers, never (recommended) on your developer machine. A broken
   environment is restored, not repaired.
3. **Human control at the merge gate.** AI produces **draft** pull requests.
   Nothing reaches your main branch without a human decision. Branch protections
   are respected.
4. **Token and attention efficiency.** Routine steps are code, not prompts. The
   expensive, creative budget is spent only where creativity is required.
5. **Generalist by default.** Almost anything that can be done with files in a
   repository is in scope — code, docs, configuration, tests, data — not just
   programming.
6. **Meet people where they are.** GitHub and Telegram are available on every
   phone, so managing the hive must not require a laptop.
7. **Open and portable.** Unlicense (public domain). No vendor lock-in; run it
   on our infrastructure or your own.

## Who It Is For

| Persona                    | Their pain                                           | What Hive Mind gives them                                             |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| **Solo developer**         | Backlog of small issues steals time from real work   | A tireless teammate that drafts fixes while they focus or sleep       |
| **Team lead / manager**    | Routine issues pile up; reviews bottleneck on people | A swarm that clears the backlog overnight, leaving only review        |
| **Open-source maintainer** | Too many issues, too few contributors                | Auto-forking workers that turn issues into reviewable PRs             |
| **Contributor**            | Wants to help but lacks write access or setup time   | Fork-and-solve flow that needs no repo permissions or local toolchain |
| **Non-coder / PM**         | Can describe a problem but not implement it          | Issue-in, PR-out workflow driven entirely from GitHub or Telegram     |
| **Org / platform team**    | Needs scalable, observable, self-hosted automation   | Kubernetes/Helm deployment, multi-account isolation, Sentry tracking  |

## User Journeys We Support Today

Each journey lists the **persona**, the **pain**, the **steps**, and the
**outcome**. Commands shown are real; see the [README](../README.md) for full
syntax.

### Journey 1 — Clear a single backlog issue

- **Persona:** Solo developer
- **Pain:** A known bug has sat in the backlog for weeks because it is boring,
  not hard.
- **Steps:**
  1. Write (or pick) a GitHub issue describing the bug.
  2. Run `solve https://github.com/owner/repo/issues/123 --model opus`.
  3. The worker spins up an isolated environment, reads the codebase, reproduces
     the bug, writes a fix and a test, and opens a **draft** pull request.
  4. Review the PR. Merge it, or comment to request changes.
- **Outcome:** What might have cost a two-hour context switch becomes a
  ten-minute review of a finished draft.

### Journey 2 — Iterate on a pull request via comments (Continue Mode)

- **Persona:** Reviewer / solo developer
- **Pain:** The first draft is 80% right but misses an edge case.
- **Steps:**
  1. Leave a normal PR review comment describing what to change.
  2. Run `solve https://github.com/owner/repo/pull/456 --verbose` (or let the
     orchestrator pick the comment up).
  3. The worker reads the feedback, updates the solution, and pushes to the same
     branch.
  4. Repeat until satisfied, then merge — or close the PR to stop work
     immediately.
- **Outcome:** Refinement happens through the normal GitHub review workflow, with
  no new tools to learn. See [flow.md](./flow.md) for the full feedback loop.

### Journey 3 — Contribute to a repo you cannot write to

- **Persona:** Open-source contributor
- **Pain:** You want to fix an issue in someone else's project but have no write
  access and no local setup for their stack.
- **Steps:**
  1. Run `solve https://github.com/owner/repo/issues/123 --fork --model opus`
     (a fork is also created automatically when write access is missing).
  2. The worker forks the repository, solves the issue on a branch in the fork,
     and opens a cross-repository pull request.
  3. The upstream maintainer reviews and merges.
- **Outcome:** Contribution without permissions, without cloning, and without
  installing the project's toolchain locally.

### Journey 4 — Clear an entire backlog overnight (Orchestration)

- **Persona:** Team lead / maintainer
- **Pain:** Dozens of issues are open; processing them one by one would take
  weeks.
- **Steps:**
  1. Point the orchestrator at a repo, user, or organization:
     `hive https://github.com/owner/repo --monitor-tag "bug" --concurrency 4`.
  2. The orchestrator continuously discovers matching issues and assigns each to
     a parallel worker (with options like `--all-issues`,
     `--skip-issues-with-prs`, `--max-issues`, `--interval`).
  3. Each worker independently drafts a PR for its issue.
  4. In the morning, a queue of draft PRs is waiting for review.
- **Outcome:** A swarm that feels like a team of developers, for the cost of a
  single subscription. _"The code is written while you sleep."_

### Journey 5 — Manage the hive from your phone (Telegram)

- **Persona:** Anyone away from their desk
- **Pain:** Inspiration (or an incident) strikes while you are on the move, with
  no laptop.
- **Steps:**
  1. Send `/solve <issue-url>` or `/hive <repo-url>` to the Telegram bot.
  2. Check progress with `/limits`; collaborate in a group chat with your team.
  3. Review and merge the resulting PR from the GitHub mobile app.
- **Outcome:** True mobile development — create issues, trigger solvers, and
  review PRs entirely from a phone. No PC, IDE, or "vibe coding" app required.

### Journey 6 — Automate non-code work (Generalist AI)

- **Persona:** Maintainer / technical writer / PM
- **Pain:** Documentation drifts, configuration needs updates, data files need
  regenerating — none of it is "coding," but it all takes time. (This very
  document was produced through that workflow.)
- **Steps:**
  1. Open an issue describing the documentation, config, or data change.
  2. Run `solve` against it like any other issue.
  3. The worker edits the relevant files and opens a draft PR.
- **Outcome:** Almost anything expressible as files in a repository can be
  automated, not just source code.

### Journey 7 — Run two budgets and tools in parallel (Multi-tool)

- **Persona:** Power user / small team
- **Pain:** One subscription's usage limits or one model's style does not fit
  every task.
- **Steps:**
  1. Configure both Claude MAX (`--tool claude`, default) and ChatGPT Pro
     (`--tool codex`).
  2. Route creative tasks to Claude and deterministic refactors to Codex —
     `/codex` or `/solve --tool codex` — or let parallel workers mix tools.
- **Outcome:** Two independent "almost unlimited" budgets and per-tool/model
  concurrency, so throughput is not capped by a single account.

### Journey 8 — Self-host safely at scale

- **Persona:** Organization / platform team
- **Pain:** You need automation that is isolated, observable, and on your own
  infrastructure.
- **Steps:**
  1. Deploy with Docker, the Ubuntu one-command setup, or Helm/Kubernetes for
     production scaling.
  2. Isolate accounts per container; rotate tokens; wire up Sentry for error
     tracking.
  3. Run orchestration against your repositories with concurrency tuned to your
     hardware.
- **Outcome:** Disposable, restorable, monitored AI workers running where your
  policies require them. See [DOCKER.md](./DOCKER.md) and [HELM.md](./HELM.md).

### Journey 9 — Survive rate limits and interruptions

- **Persona:** Any user on a long-running task
- **Pain:** A model hits its usage limit halfway through, and naive tools simply
  fail.
- **Steps:**
  1. A worker that hits a limit records a resume command and can auto-continue
     when the limit resets.
  2. Resume explicitly with
     `solve <issue-url> --resume <session-id>` when needed.
  3. Attach logs and a solution summary to the PR with `--attach-logs` and
     `--auto-attach-solution-summary` for transparency.
- **Outcome:** Long tasks complete across interruptions instead of being lost.

## User Journeys We Want to Support (Future)

These journeys describe the **direction** of the project. They are not all
implemented yet; they are listed so the documentation captures both what we
support today and what we can potentially support in the future.

### Future Journey A — Architect AI for task decomposition

- **Persona:** Developer facing a large, multi-step feature
- **Today's limitation:** Hive Mind excels at small, well-scoped tasks; large
  features must be broken down by a human first.
- **The vision:** An "architect" AI decomposes a big issue into a graph of
  small sub-issues, dispatches them to the swarm, and performs a final
  integration review — turning one large request into many parallel drafts.

### Future Journey B — Collective human intelligence in the loop

- **Persona:** Worker that hits a genuine knowledge gap
- **The vision:** When requirements are ambiguous or domain expertise is
  required, the system routes a precise question to the right human (or pool of
  humans) for requirements, expertise, or feedback — and resumes automatically
  once answered. The "hive" combines AI workers _and_ people.

### Future Journey C — Autonomous quality and self-review loops

- **Persona:** Maintainer who wants higher first-pass quality
- **The vision:** Dedicated reviewer agents critique and harden each draft —
  adversarially verifying fixes, expanding test coverage, and flagging
  regressions — before a human ever opens the PR.

### Future Journey D — Continuous repository stewardship

- **Persona:** Long-lived project
- **The vision:** A standing hive that proactively watches a repository for
  dependency updates, failing or flaky tests, documentation drift, and security
  advisories, and opens draft PRs to address them without waiting for a human to
  file an issue.

### Future Journey E — Cross-repository and org-wide initiatives

- **Persona:** Platform team rolling out a change everywhere
- **The vision:** Describe a change once (e.g. "migrate every service off the
  deprecated API") and have the swarm fan out across many repositories,
  coordinating consistent draft PRs org-wide.

> Have a journey you need that is not listed here? That gap is itself a great
> issue to open — Hive Mind is built to grow through exactly this loop.

## How Journeys Map to the Pain

| Pain (from [The Pain](#the-pain)) | Journeys that address it |
| --------------------------------- | ------------------------ |
| Endless backlog of small work     | 1, 4, Future A, Future D |
| Babysitting AI tools              | 1, 2, 9                  |
| Unsafe local execution            | 1, 8                     |
| Context switching kills flow      | 1, 4, 5                  |
| Tied to a computer                | 5                        |
| Work does not scale               | 4, 7, Future A, Future E |
| Tokens wasted on plumbing         | 1, 2, 9                  |
| Ambiguous requirements            | 2, Future B              |
| First-pass quality                | 2, Future C              |

## Where to Go Next

- **What it can do:** [FEATURES.md](./FEATURES.md)
- **How it compares to hiring, IDEs, and other agents:** [COMPARISON.md](./COMPARISON.md)
- **How the data and feedback loops work:** [flow.md](./flow.md)
- **How to get the best results:** [BEST-PRACTICES.md](./BEST-PRACTICES.md)
- **Install and quick start:** [README](../README.md)

_Hive Mind is 100% open source under the Unlicense. The fastest way to shape this
vision is to open an issue — and let the hive help solve it._
