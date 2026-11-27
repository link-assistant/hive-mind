# Source inventory

## Request and scope

Issue #4177 calls for a full, evidence-backed comparison of Hive Mind and Up.computer and an actionable competitive plan. It explicitly assigns existing GitHub functions to GitHub, asks for online research and a component survey, and scopes this pull request to research and comparison. The issue and PR initially contained zero issue comments, zero required sub-issues, zero PR conversation comments, zero inline review comments, and zero PR reviews. The issue timeline recorded the cross-reference to PR #4178. [Issue](https://github.com/link-assistant/hive-mind/issues/4177) · [Sub-issue endpoint](https://api.github.com/repos/link-assistant/hive-mind/issues/4177/sub_issues) · [Pull request](https://github.com/link-assistant/hive-mind/pull/4178)

## Method and limits

On 2026-11-27, the survey checked the issue and PR through GitHub CLI and all three PR comment/review APIs, compared the latest stable release and main branch through GitHub, enumerated `docs/user` from the pinned tree, and checked the guides against public product flags, module source, release files, and upstream changes. On the Hive Mind side it checked the package entry points, docs, and implementation paths at the PR base. The research also followed product and platform claims to public first-party pages. Section IDs correspond to the evidence references in the [comparison](../comparison.md).

Release assets and flags take precedence for shipping status. Source and guides can establish intended operation. A PR description or screenshot only supports the flow it shows. The study used the upstream bot-mention screenshots and public pages. It left binary installation, authenticated provider/relay operation, signing verification, and product measurements to the controlled pilot described in the roadmap. The linked commits keep the source survey reproducible, and the live links can change. [Pilot design](../roadmap.md#w7--benchmark-and-positioning)

To repeat the snapshot, list the issue, children, and all PR reactions and feedback separately. Then fetch the indexed revisions and list the guide names from the release tree. The release metadata holds the date and list of shipped files.

```bash
gh issue view 4177 --repo link-assistant/hive-mind --comments
gh api repos/link-assistant/hive-mind/issues/4177/comments --paginate
gh api repos/link-assistant/hive-mind/issues/4177/sub_issues --paginate
gh api repos/link-assistant/hive-mind/issues/4178/comments --paginate
gh api repos/link-assistant/hive-mind/pulls/4178/comments --paginate
gh api repos/link-assistant/hive-mind/pulls/4178/reviews --paginate
gh api repos/link-assistant/hive-mind/issues/4178/reactions --paginate
gh release view core-v0.0.41 --repo krl-gr/upcomputer --json url,publishedAt,assets
gh api 'repos/krl-gr/upcomputer/git/trees/a1e6ad2791e635d9818166a81b68dee42a9bb9df?recursive=1' \
  --jq '.tree[] | select(.type == "blob" and (.path | startswith("docs/user/"))) | .path'
```

## Up.computer

### U0 — Shipping evidence and product flags

- Stable Core 0.0.41 published on 2026-11-25 at 14:25 UTC. The release resolves to `a1e6ad2791e635d9818166a81b68dee42a9bb9df`. Main was `714b9ec506f3ac53d30f338c412032fa40906224`, one release-metadata commit ahead with the same guides and flags. Assets include macOS arm64 and x64 DMG/ZIP, Windows x64 EXE, Linux amd64 DEB and x86_64 AppImage, and update metadata. The release has zero native mobile assets. A separate nightly was published as a prerelease. [Stable](https://github.com/krl-gr/upcomputer/releases/tag/core-v0.0.41) · [Nightly](https://github.com/krl-gr/upcomputer/releases/tag/v0.0.41-nightly.20261125.778) · [Source tree](https://github.com/krl-gr/upcomputer/tree/a1e6ad2791e635d9818166a81b68dee42a9bb9df) · [Release-to-main diff](https://github.com/krl-gr/upcomputer/compare/a1e6ad2791e635d9818166a81b68dee42a9bb9df...714b9ec506f3ac53d30f338c412032fa40906224)
- Enabled defaults are `pullRequestAgentTools`, `terminalSurface`, `devices`, `mcpOAuth`, `scheduledTaskWebhooks`, `defaultBrowser`, `cliCommand`, `mcpApps`, and `usageDataNotice`. Disabled defaults are `pullRequests`, `terminal`, `threadSettlement`, `t3Chat`, `triage`, `fleetTrackSwitch`, `mobileApp`, `standaloneCli`, and `issues`. The Issues client override and the server's issue operations have separate enablement. The PR tool switch controls server tools, runtime prompts, and watching jobs separately from PR review surfaces. The terminal panel has its own switch. [Flags](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/apps/web/src/product/productFlags.ts) · [Flag behavior](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/internals/product-flags.md) · [Public server composition](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/apps/server/src/product/publicProduct.ts)
- The guide index lists Devices among inherited surfaces while the named product flag enables Devices. Source-control, terminal, mobile, and updater guides retain sections for gated features. The root README classifies the bundled relay infrastructure as inherited. The live hosted client and documented Connect deployment are separate evidence from what is included in desktop downloads. [Root README][up-readme] · [Guide index](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/README.md) · [Connect setup](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/operations/upcomputer-connect-setup.md) · [Hosted app](https://app.up.computer/)

### U1 — Tasks and workers

Tasks have person and agent audiences, tags/projects, ordering, status transitions, reminders, output, and events. Workers have project scoping, status/tag and prior-run triggers, capabilities tied to the selected agent, a one-run-at-a-time policy per worker, and instructions used to manage the queue. Worker-generated threads start in the project root with a null worktree path. Interactive thread worktrees are a separate capability. [Getting started][getting-started] · [Tasks and planner][tasks] · [Workers][workers] · [Task agent implementation](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/packages/tasks-server/src/agents/TaskAgentService.ts#L1237-L1253) · [Task repository](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/packages/tasks-server/src/persistence/TaskRepositoryLive.ts)

### U2 — Scheduling and webhooks

Automations create task occurrences from a recurrence or webhook. Scheduled prompts wake a thread directly. Templates, manual runs, and results are described alongside missed-run and duplicate-open behavior. The recurrence and occurrence handling has a server implementation. [Automations][automations] · [Project settings][project-settings] · [Automation implementation](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/packages/tasks-server/src/automations/TaskAutomationService.ts)

### U3 — Bots and memory

Bots add a permanent chat, project scope, updatable configuration, memory, and background delegation. PR #135 shows the before and after of the `@bot` picker and an attributed reply in the originating chat. The stored mention supports delivery after restart and uses recent context. The release includes a user-selected Agent-managed memory mode. Open issue #133 asks for provider-aware handling of native memory. [Bot guide][bots] · [Bot tool definitions](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/packages/tasks-server/src/tools/TaskToolDefinitions.ts) · [Mention implementation](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/packages/tasks-server/src/bots/BotMentions.ts) · [Memory migration](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/packages/tasks-server/src/persistence/migrations/045_BotMemoryMode.ts) · [PR #135 with screenshots](https://github.com/krl-gr/upcomputer/pull/135) · [Issue #133](https://github.com/krl-gr/upcomputer/issues/133)

### U4 — Service, privacy, and policy

A local server persists workspace state, brokers provider requests, can run in the background on macOS/Linux, and exposes settings for diagnostic export and managed restrictions. Published privacy terms distinguish host state, model/provider processing, product analytics, and relay observations. Permission behavior depends on the backend. [Service][background-service] · [Managed policy][managed-policy] · [Permission modes][permission-modes] · [Secrets][secrets] · [1Password Connect][secrets-1password-connect] · [1Password service account][secrets-1password-service-account] · [Telemetry][telemetry] · [Privacy policy](https://up.computer/privacy/)

### U5 — Threads and context

The guides show the composer, thread organization, side chats, attachments, portable handoffs, provider-specific native sessions, and thread migration. Internal notes describe session lineage, transfer boundaries, and provider capabilities. A portable handoff transports selected context. Native provider state still depends on the adapter and environment. [Composer][composer] · [Thread sidebar][thread-sidebar] · [Portable handoffs][portable-handoffs] · [Thread migration][thread-migration] · [Question attachments][question-attachments] · [Provider switching](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/orchestration-v2/provider-switching-and-context.md) · [Thread lineage](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/orchestration-v2/thread-lineage-and-context-transfer.md)

### U6 — Remote access and sharing

The remote guide describes hosted Connect, LAN/private network and SSH options, device approval and revocation, a three-connected-machine limit (clients do not count), load balancing for new threads, and host affinity for existing ones. Guest links and external agents have narrower credentials and different privileges. Browser notifications depend on supported clients, permissions, and deployment. [Remote access][remote-access] · [Guest links][guest-links] · [Connect troubleshooting][t3-connect-troubleshooting] · [Mobile notifications][mobile-notifications] · [Outside agents][outside-agents] · [Remote architecture](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/internals/remote.md) · [Orchestrator MCP server](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/orchestration-v2/orchestrator-mcp-server.md)

### U7 — Source control and issues

The source-control guide maps account and forge support, local diffs, Git operations, PRs and Issues. Apply U0 to review guides, viewed-file state, stacks, settlement, triage, and the experimental Issues interface. Upstream architecture notes still explain file-level review history. [Source control][source-control] · [Triage][triage] · [PR file revision notes](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/internals/pull-request-file-revisions.md)

### U8 — Install, providers, and usage

Downloads and the updater distinguish stable and nightly desktop clients. The README describes macOS signing/notarization, unsigned Windows builds, and the desktop-bundled `up` command. The welcome flow can offer OpenCode Zen, and provider notes distinguish auth, model selection, permission modes, native session affinity, compaction, and supported features. The usage guide includes pricing overrides, subscription views, and CLIProxyAPI. [Root README][up-readme] · [Install][install] · [Updating][updating] · [FAQ][faq] · [Welcome][welcome-page] · [Usage][usage] · [Licenses][open-source-licenses] · [Zen setup catalogue](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/apps/web/src/product/openCodeZenModels.ts)

Provider guide inventory. [ACP][providers-acp] · [Antigravity][providers-antigravity] · [Claude][providers-claude] · [Codex][providers-codex] · [Cursor][cursor] · [fx][providers-fx] · [Kiro][providers-kiro] · [Muse Code][providers-muse] · [OpenCode][providers-opencode] · [Pi][providers-pi] · [Provider registry notes](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/internals/providers.md)

### U9 — Workspace and accessibility

The workspace documentation includes terminal and tool activity, rendered replies, browser/profile setup, computer-use targets, client settings, multilingual UI infrastructure, and assistive navigation. Device functions can depend on the host and platform. [Activity log][activity-log] · [Appearance][appearance] · [Browser import][browser-import] · [Default browser][default-browser] · [Devices][devices] · [Visual replies and MCP apps][html-renders] · [Keyboard focus][keyboard-focus] · [Keybindings][keybindings] · [Prompt links][prompt-links] · [SnapShots][snap-shot] · [Terminal][terminal] · [Text generation][text-generation] · [Voice input][voice-input] · [Localisation](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/internals/i18n.md) · [Computer-use policy source](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/packages/computer-use-server/src/computerUse/ComputerUsePolicy.ts)

### U10 — Project configuration and internals

Project configuration controls inheritance, scheduling, branch/worktree naming, cleanup, default branch maintenance, and project identity. Internal descriptions distinguish provider coordination, client runtime, task persistence, and relay/auth boundaries. Public server product modules contribute RPCs, routes and migrations. Separate design notes explain correlation IDs and lifecycle semantics. [Project settings][project-settings] · [Architecture](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/internals/overview.md) · [Client runtime](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/packages/client-runtime/README.md) · [Environment auth](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/internals/environment-auth.md) · [Entity IDs and correlation](https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/orchestration-v2/entity-ids-and-correlation.md)

### U11 — Live site and upstream history

- The public product and download pages advertise a host-local operating model, desktop downloads, hosted browser access, and multi-agent coordination. Atlas is marketed separately. Blog pages illustrate agent tasks, running multiple agents, and provider authentication approaches. [Product](https://up.computer/) · [Download](https://up.computer/download/) · [Atlas](https://up.computer/atlas/) · [Task management](https://up.computer/blog/task-management-for-ai-agents/) · [Parallel agents](https://up.computer/blog/run-multiple-coding-agents/) · [Provider access](https://up.computer/blog/subscription-api-or-reseller/)
- Release preparation and the bot-mention UX merged before the inspected release. Earlier merged work covers T3 upstream sync, rich task output, and orphan event integrity. The branded iPhone PR remained a draft and the follow-on integration branch was open when inspected. [Release prep #136](https://github.com/krl-gr/upcomputer/pull/136) · [Bots #135](https://github.com/krl-gr/upcomputer/pull/135) · [Upstream sync #131](https://github.com/krl-gr/upcomputer/pull/131) · [Rich task output #121](https://github.com/krl-gr/upcomputer/pull/121) · [Run integrity #119](https://github.com/krl-gr/upcomputer/pull/119) · [iPhone #108](https://github.com/krl-gr/upcomputer/pull/108) · [Integration branch #137](https://github.com/krl-gr/upcomputer/pull/137)

## Hive Mind

Baseline commit `eca1468be17b3cb91b876ca6807f128c8e7af1d9` is Hive Mind 2.50.0. The survey read the GitHub workflow, deployment, and configuration docs alongside the code owning the corresponding behavior. [Baseline revision](https://github.com/link-assistant/hive-mind/tree/eca1468be17b3cb91b876ca6807f128c8e7af1d9) · [Package metadata and entry points](https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/package.json)

### H1 — Public entry points

The package exposes `hive`, `solve`, `task`, and operator or maintenance commands. The README distinguishes monitored work, targeted issue/PR/repository runs, free-text task creation, alpha reviewers, and package setup. [README][hm-readme] · [Task entry point][hm-task] · [Solve entry point][hm-solve] · [Review entry point][hm-review]

### H2 — Orchestration and tracker intake

`hive` selects GitHub or YouTrack repositories/issues, uses labels or configured project statuses, and enforces concurrency and issue relations. Task creation can split a prompt. The queue calculates ordering and handles inherited blockers and open children. [Hive configuration][hm-hive-config] · [Issue queue][hm-hive-queue] · [Issue relations][hm-hive-relations] · [Task issue creation][hm-task-issues] · [Task splitting][hm-task-split]

### H3 — Telegram

Telegram is a remote task control plane, including named peer routing, pending/running/blocked queue states, success and completion dependencies, resource and model information, logs, and interactive terminal observation. Its command integrations set the supported boundary for chat and operational control. [Telegram entry point][hm-telegram] · [Peer discovery][hm-peers] · [After command][hm-after] · [Solve queue][hm-telegram-queue] · [Issue blockers][hm-telegram-blockers] · [Terminal watch][hm-terminal] · [Telegram peer routing PR #4102](https://github.com/link-assistant/hive-mind/pull/4102)

### H4 — Solve and review

The solve path constructs the repository workspace and draft PR, handles repository-mode issue collection, and continues from feedback. Config makes live comment mode experimental and backend-specific. Issue completion, reviewer apps, and thread resolution are distinct checks and can be selected through options. [Preparation][hm-preparation] · [Draft PR setup][hm-auto-pr] · [Repository mode][hm-repo-mode] · [Solve configuration][hm-solve-config] · [Session comments][hm-session-comments] · [Review apps][hm-review-bots] · [Review threads][hm-review-threads] · [Issue completion guide][hm-completion] · [Review app continuation PR #4084](https://github.com/link-assistant/hive-mind/pull/4084)

### H5 — Delivery and maintenance

Optional automated merge uses current PR, test, and review state. The repository supports separate Formal AI paths and a maintenance command for CI/dependency issues. GitHub owns the final checks and repository merge rules. [Merge guards][hm-merge-guards] · [CI signals][hm-ci] · [Maintenance CLI][hm-fix] · [Formal AI guide][hm-formal] · [Readiness PR #4107](https://github.com/link-assistant/hive-mind/pull/4107)

### H6 — Agents and models

Built-in agent commands and `agent-commander` cover different runtimes. The tools expose model discovery, credential and provider configuration, context/usage data, and MCP baseline configuration. Capabilities vary by provider. [Backend dispatch][hm-agent-command] · [Agent commander][hm-agent-commander] · [MCP baseline][hm-agent-mcp] · [Model aliases and options][hm-config] · [Free models][hm-free] · [OpenRouter][hm-openrouter]

### H7 — Fleet operations

Manager docs describe a CLI and JavaScript library for managing deployments, remote sign-in, scoped access, backup, logs and storage, and recovering task state. Retained sessions are distinct from host-wide routing. The Router is a separate deployment and isolation boundary. [Manager](../../../deployment/hive-manager.md) · [Operator manual](../../../deployment/hive-manager-manual.md) · [Manager source][hm-manager] · [Router][hm-router] · [Screen log collection][hm-logs] · [Manager deployment PR #4096](https://github.com/link-assistant/hive-mind/pull/4096)

### H8 — Packaging and policy

The project provides npm/CLI entry points, Docker and Coolify deployment, an experimental Helm chart, and several per-runtime isolation controls. Telemetry and session sharing are configurable. Review policy and tracked configuration remain separate from deployment secrets. [Docker][hm-docker] · [Helm][hm-helm] · [Configuration][hm-config] · [Router auth boundary][hm-router-auth] · [Docker sidecar][hm-sidecar]

[up-readme]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/README.md
[activity-log]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/activity-log.md
[appearance]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/appearance.md
[automations]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/automations.md
[background-service]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/background-service.md
[bots]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/bots.md
[browser-import]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/browser-import.md
[composer]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/composer.md
[cursor]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/cursor.md
[default-browser]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/default-browser.md
[devices]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/devices.md
[faq]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/faq.md
[getting-started]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/getting-started.md
[guest-links]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/guest-links.md
[html-renders]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/html-renders.md
[install]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/install.md
[keybindings]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/keybindings.md
[keyboard-focus]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/keyboard-focus.md
[managed-policy]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/managed-policy.md
[mobile-notifications]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/mobile-notifications.md
[open-source-licenses]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/open-source-licenses.md
[outside-agents]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/outside-agents.md
[permission-modes]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/permission-modes.md
[portable-handoffs]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/portable-handoffs.md
[project-settings]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/project-settings.md
[prompt-links]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/prompt-links.md
[providers-acp]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-acp.md
[providers-antigravity]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-antigravity.md
[providers-claude]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-claude.md
[providers-codex]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-codex.md
[providers-fx]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-fx.md
[providers-kiro]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-kiro.md
[providers-muse]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-muse.md
[providers-opencode]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-opencode.md
[providers-pi]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/providers-pi.md
[question-attachments]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/question-attachments.md
[remote-access]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/remote-access.md
[secrets-1password-connect]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/secrets-1password-connect.md
[secrets-1password-service-account]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/secrets-1password-service-account.md
[secrets]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/secrets.md
[snap-shot]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/snap-shot.md
[source-control]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/source-control.md
[t3-connect-troubleshooting]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/t3-connect-troubleshooting.md
[tasks]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/tasks.md
[telemetry]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/telemetry.md
[terminal]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/terminal.md
[text-generation]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/text-generation.md
[thread-migration]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/thread-migration.md
[thread-sidebar]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/thread-sidebar.md
[triage]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/triage.md
[updating]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/updating.md
[usage]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/usage.md
[voice-input]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/voice-input.md
[welcome-page]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/welcome-page.md
[workers]: https://github.com/krl-gr/upcomputer/blob/a1e6ad2791e635d9818166a81b68dee42a9bb9df/docs/user/workers.md
[hm-readme]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/README.md
[hm-task]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/task.mjs
[hm-solve]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/solve.mjs
[hm-review]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/review.mjs
[hm-hive-config]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/hive.config.lib.mjs
[hm-hive-queue]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/hive.issue-queue.lib.mjs
[hm-hive-relations]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/hive.issue-relations.lib.mjs
[hm-task-issues]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/task.issue-creation.lib.mjs
[hm-task-split]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/task.split.lib.mjs
[hm-telegram]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/telegram-bot.mjs
[hm-peers]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/telegram-peer-discovery.lib.mjs
[hm-after]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/telegram-after-command.lib.mjs
[hm-telegram-queue]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/telegram-solve-queue.lib.mjs
[hm-telegram-blockers]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/telegram-solve-blockers.lib.mjs
[hm-terminal]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/telegram-terminal-watch-command.lib.mjs
[hm-preparation]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/solve.preparation.lib.mjs
[hm-auto-pr]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/solve.auto-pr.lib.mjs
[hm-repo-mode]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/solve.repository-mode.lib.mjs
[hm-solve-config]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/solve.config.lib.mjs
[hm-session-comments]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/solve.session-comments.lib.mjs
[hm-review-bots]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/review-bots.lib.mjs
[hm-review-threads]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/review-threads.lib.mjs
[hm-completion]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/ISSUE_COMPLETION.md
[hm-merge-guards]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/solve.auto-merge-guards.lib.mjs
[hm-ci]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/github-merge-ci-signals.lib.mjs
[hm-fix]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/fix.mjs
[hm-formal]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/FORMAL-AI-DRAFTS.md
[hm-agent-command]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/native-agent-command.lib.mjs
[hm-agent-commander]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/agent-commander.lib.mjs
[hm-agent-mcp]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/agent-mcp-baseline.lib.mjs
[hm-config]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/CONFIGURATION.md
[hm-free]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/FREE_MODELS.md
[hm-openrouter]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/OPENROUTER.md
[hm-manager]: https://github.com/link-assistant/hive-mind/tree/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/hive-manager
[hm-router]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/ROUTER.md
[hm-logs]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/COLLECTING-LOGS.md
[hm-docker]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/DOCKER.md
[hm-helm]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/docs/HELM.md
[hm-router-auth]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/router-auth-guard.lib.mjs
[hm-sidecar]: https://github.com/link-assistant/hive-mind/blob/eca1468be17b3cb91b876ca6807f128c8e7af1d9/src/docker-sidecar.lib.mjs
