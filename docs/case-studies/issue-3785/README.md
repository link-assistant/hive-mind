# Issue 3785: limits, rotating credentials, and task state

Investigation date: 2026-10-26. Issue: [3785](https://github.com/link-assistant/hive-mind/issues/3785).
Implementation: [PR 3786](https://github.com/link-assistant/hive-mind/pull/3786).
Baseline: `43ea0960bec147c1a723d3265af9e9e65852cab6`, Hive Mind 2.39.7.
Observed failed CLI: Codex 0.164.0. Local Claude CLI: 2.1.310.

**The issue remains unfinished.** Display, entitlement labeling, cache invalidation,
Router usage selection, and task-owned Codex catalog discovery are implemented.
The default canonical authentication/history contract, complete global baseline enforcement,
migration, and packaged-image release/deployment gates are not implemented or
verified by these changes. Passing the tests below does not satisfy those criteria.

## Evidence and incident sequence

The complete issue and both comments were read, along with all PR conversation
comments, inline comments and reviews. The sub-issue API returned no required
sub-issues. Sanitized API captures are under `experiments/issue-3785/`.

| UTC time                             | Evidence                                                                                          | Interpretation                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-25 14:59:28                  | Original issue and two screenshots                                                                | Claude's auth error is inside the system metrics block; Codex has a separate heading, a future subscription date, and an auth error. The queue reports one Codex task processing.          |
| 2026-10-25 15:10:44                  | Checks and release run 40205703613, head `43ea0960`                                               | `action_required`, no jobs/logs. This is an approval state, not evidence of a failing code assertion.                                                                                      |
| 2026-10-25 15:13:03.789              | Failed task log, lines 359–362                                                                    | Codex 0.164.0 receives refresh HTTP 401 and reports a refresh token already used.                                                                                                          |
| 2026-10-25 15:35:24, edited 18:51:02 | [First comment](https://github.com/link-assistant/hive-mind/issues/3785#issuecomment-6399598109)  | Operator compares the surviving scoped task credential with the stale base and newly failed task. Subsequent tool calls establish continuing execution independently of the queue counter. |
| 2026-10-25 21:51:04                  | [Second comment](https://github.com/link-assistant/hive-mind/issues/3785#issuecomment-6403814424) | Operator reports completed server cleanup and control-center guard, and requires structural isolation and release gates here. Cleanup is not proof of launcher enforcement.                |
| 2026-10-26                           | Synthetic production-preflight probe                                                              | Task A rotation stays private, B copies the predecessor, and repeated A preflight overwrites A's replacement.                                                                              |
| 2026-10-26                           | Docker probes, including real Codex 0.164.0 with networking disabled                              | File mounts retain old inodes; mounted files cannot be replaced/unlinked; a directory-mounted control supports real CLI logout/login.                                                      |

The private bot log contains successful and later failed Codex usage responses.
Its authenticated Claude profile has `account.has_claude_max: true` and
`organization.subscription_status: active`, but no reliable paid-access end date.
The local credential's plan label and a JWT subscription date are independent
of whether a new authenticated usage request succeeds.

The historical successful token-exchange response was not captured. Identifying
the surviving task's refresh as the consumption event is an inference supported
by the operator's generation comparison, the copy path, and the reuse error.
The original queue counter alone would not establish this.

### Retained artifacts

- [Original display screenshot](evidence/original-1.png) and
  [browser usage screenshot](evidence/original-2.png): downloaded, identified as
  PNG with `file`, and visually inspected.
- [Before/after renderer comparison](evidence/display-comparison.png), generated
  from synthetic data in a real browser. This is a Markdown layout fixture,
  not a live Telegram or provider screenshot. The same subscription helper is
  used in both columns, so the comparison isolates section placement.
- [Failed execution log](evidence/failed-task.log.gz) and
  [complete related bot log](evidence/bot.log.gz): sanitized before compression.
  `gzip -dc` restores readable logs. Inspect at most 1500 lines at a time.
  [Manifest](evidence/manifest.json) records sanitized-content hashes and sizes.
  The raw files, download URL credentials, account identifiers and emails are
  not published. Sanitization and a residual scan used the repository's
  fail-closed streaming sanitizer with 64 KiB chunks and a 192 MiB JS heap cap.
- Reproducing failures and probe outputs are in `evidence/*-before.log`,
  `evidence/auth-copy.log`, `evidence/file-mount.log`, and
  `evidence/codex-storage.log`, and `evidence/concurrent-refresh.log`. Successful focused tests are in
  `evidence/limits-final.log`. Synthetic test outputs have trailing whitespace
  removed; compressed incident logs retain the sanitized bytes in the manifest.

## Root causes and changes

### Section placement and entitlement provenance

`formatUsageMessage()` previously used a subscription heading as the condition
for creating Claude's section. When the profile request failed, no subscription
object existed; the same error text was appended to the system metrics block.
Claude now gets a fallback limits heading even when subscription metadata is
unavailable. Codex also gets a separate section without a plan/metadata object.

Claude plan detection previously preferred `claudeAiOauth.subscriptionType`
from disk. An authenticated profile's account entitlement flags now take
precedence. Explicit false flags for both Max and Pro identify free access;
a missing/unauthenticated profile does not imply cancellation. A cancellation
status alone does not remove a still-active paid entitlement.

Codex subscription claims are decoded locally and are not verified by that
operation. The heading now labels them as **stored metadata**, including when
a future date accompanies HTTP 401. This label is localized in English,
Russian, Chinese and Hindi. A fresh usage request still determines whether the
request credential works.

### Cache identity and effective homes

Successful usage and subscription results could outlive credential rotation or
logout. Authentication failures were invalidated only by modification time;
an atomic replacement with the same mtime could leave a stale failure cached.
Concurrent requests for different credential paths could share one request.

Cache entries and in-flight requests now include the resolved credential path
and file generation (`dev`, inode, nanosecond mtime/ctime, size). Both successes
and auth failures check the generation. Logout invalidates stored subscription
claims. Existing rate-limit cooldown behavior is retained. Credential values
are not put into cache keys or diagnostics.

A full local run also exposed intermittent queue-test interference: automatic
consumers continued usage checks after `stop()`, while later tests reset the
cache. Pending usage requests were shared across cache instances. A deterministic
regression fails before the fix (14 passed, one failed); requests now coalesce
within their cache instance, and all 22 focused cache/limits tests pass. Queue
unit tests disable automatic consumers and explicitly exercise their operations;
all 71 assertions pass. Production queue startup behavior is unchanged.

Native `/limits` credential readers resolve `CLAUDE_CONFIG_DIR` and `CODEX_HOME`
at call time. This removes an unconditional fallback to the default home; it
does **not** validate that a redirected home is the deployment's canonical
authority. The launcher-level effective-path validation remains unfinished.

Verbose usage diagnostics used to record token suffixes, account IDs, all
response headers and raw bodies. They now retain structural usage-window
information and HTTP status only. Malformed credential/provider JSON errors
also omit input excerpts from diagnostics and returned messages. Provider
requests have a 30-second bound. A later CodeQL review identified that the
successful subscription diagnostic still carried a credential-derived plan
label; it now emits a constant message. A regression preserves returned
metadata while proving credential/provider sentinel values stay out of logs.

### Explicit Router usage authority

When `HIVE_MIND_USE_ROUTER` selects Router, `/limits` requests the selected
Router's `/api/usage/anthropic` or `/api/usage/openai` schema-v1 endpoint with the
Router client credential. Usage and subscription metadata share that response.
An unavailable/unverified result, missing token, unsupported schema or HTTP
error returns a Router-specific error; it never falls back to vendor auth files.
The adapter retains named windows, additional metered Codex limits and credits.
This uses the existing backend API rather than independently refreshing OAuth.

The Docker command builder also had an explicit native-mount fallback when
Router was selected without an issued task token. It now rejects missing tokens,
invalid endpoints, invalid dialects and dialects without a provider route before
constructing vendor mounts. Task and Git routes use the dialect selected by the
launch environment rather than an unrelated process-global image selection.
Route validation precedes lease acquisition, and the lease carries that dialect
through attachment, Codex provider-file wiring and coverage diagnostics. Regression tests first
reproduced premature acquisition and loss of the selected dialect at both steps.
The broader backend storage/audit contract remains unvalidated.

The repository pins Router 0.125.4 pending
[3395](https://github.com/link-assistant/hive-mind/issues/3395). That version
does not establish the newer usage API contract. An explicit backend without
the endpoint returns an honest unavailable result. This patch neither changes
the pin nor certifies Router's broader auth/storage/audit isolation contract.

### Catalog discovery isolation

Codex preflight previously listed available plugins using the root home, then
linked writable root `.tmp/plugins` marketplace state into the scope. Installing
and verifying capabilities in a scope did not isolate discovery itself.
Discovery now runs after task scope preparation with its scoped environment;
marketplace state remains local to that scope. Remote plugin sync is disabled
before discovery, and no root marketplace link is created.

This is a useful containment change, not a clean-root attestation. Existing
scope reuse, stock `.system` trust, other global search paths, startup restore,
and migration still require the larger contract described below.

### Existing global-audit repair safety

The existing `runAgentConfigAudit()` could treat malformed/unreadable JSON as
absent and follow linked settings or plugin ancestors during repair. A settings
hard link could modify credentials, and a linked plugin ancestor could redirect
recursive cleanup into conversation storage. Logging also yielded between
inspection and repair, allowing a concurrent edit to invalidate its plan.

Its production entry now validates its existing input paths asynchronously,
rejecting linked roots/ancestors, linked/nonregular configuration files,
unreadable inputs and malformed/non-object JSON before any repair. Configuration reads
use `O_NOFOLLOW`, descriptor identity checks and a fixed 1 MiB limit, including
when a writer grows the file after the size check. TOML syntax is validated with
`smol-toml` before repair; unreadable or malformed Codex configuration cannot
become an empty configuration. Directory enumeration is bounded.
The input generations are checked again after logging before synchronous repair.
The original nine regressions fail against the retained pre-fix implementation
and pass after the change; two more reproduce malformed TOML and concurrent
file growth. They verify synthetic protected content and identity preservation.
Empty-parent pruning now counts hidden entries and uses nonrecursive removal,
preserving stock `.system` files and refusing a directory filled concurrently.
Run `node experiments/issue-3785/probe-audit-inputs.mjs --baseline` to reproduce
the old failures. The same command without `--baseline` runs the current code.

Production callers now require a clean re-audit of these known surfaces before
native connection checks. Remaining findings (including warn-only agents and
commands), repair failures, disabled repair with contamination, and additions
during audit logging reject admission. This is wired into `solve`, `hive` and
the root Telegram bot. Dry-run/command preparation does not repair state.

TOML discovery and repair use the parsed document rather than table-header
matching. Inline/dotted/quoted registrations cannot evade discovery, nested
server settings are removed with their parent, and table-like text in multiline
strings is not mistaken for a registration. The retained before output has 16
failures; all 24 admission regressions pass after the semantic repair. Unrelated
typed settings, approved MCP settings and protected state are preserved.
Repair normalizes TOML formatting and removes comments. Clean configurations
remain byte-for-byte unchanged.

The next baseline reproducer adds 13 initially failing cases: global Claude
instructions/rules and inline hooks, Codex global instructions/prompts and hook
manifests, inline notification/instruction hooks, profile-level additions and
global agent roles. These now block admission. Safe configuration entries are
removed; instruction files and hook manifests are retained for explicit removal
or quarantine. The baseline suite also verifies credential identity preservation,
linked-file rejection, malformed-manifest rejection before unrelated repairs,
and unchanged clean profiles. All 23 baseline regressions pass.

The MCP follow-up first reproduces 30 name-spoofing cases across Claude, Codex
and Codex profiles. Registration admission now checks the supported `npx`
package/argument shape, local transport, empty environment and typed timeout
settings; it rejects arbitrary commands, package sources, scripts, config files,
working directories and injected environment before any repair. A real native
registration probe also established that `CLAUDE_CONFIG_DIR=$HOME/.claude` puts
user MCP state in `.claude/.claude.json`. Ten additional bypasses there reproduced
before adding that conventional path to bounded input and semantic checks.
The focused audit suites pass 128 tests, including unchanged approved settings
and protected credential identity. The real pinned CLIs save registrations
accepted by this baseline in disposable homes. Arbitrary effective config paths
and executable/package integrity still require broader attestation.

The stock-runtime follow-up starts with nine failures: arbitrary hidden
`.system` content was admitted, and image CLI versions were not pinned. The root, DinD and Coolify image definitions
now pin Claude 2.1.310 and Codex 0.164.0 and disable Claude auto-update. A pristine
network-disabled Codex home materializes 50 stock files; repeated clean runs
produce the same relative-path/SHA-256 manifest. Admission checks installed
stock content against that bundled manifest with bounded descriptor reads and
concurrent identity checks, including nested and hidden files. Extra, changed,
missing, linked and oversized content rejects before unrelated repair. A fresh
home with no stock directory can still initialize; an existing incomplete tree
is rejected. The 12 stock regressions pass, and `probe-stock-skills.mjs --verify`
verifies the real CLI's pristine tree through production admission. CLI upgrades
must regenerate and review the manifest. Actual release-image and deployment
coverage remains unfinished.

The Docker PR check previously installed the published `latest` package, so it
could pass without any runtime implementation from the branch. PR builds now
pack this branch through npm's release file allowlist and install that archive
in both images. All three image definitions require `configure-claude` and run
the installed `verify-agent-runtime.mjs` with build networking disabled. It
checks pinned CLI versions and known global surfaces without repair, creates
a disposable home, asks the actual Codex app-server to materialize stock, and
verifies its complete content manifest. A successful RPC without a stock tree
is rejected. Reads, response sizes and probe duration are bounded; the server
is reaped before its temporary home is removed. Container verification invokes
the installed module again after boot. No development source is mounted for
this check. Two initial package/gate regressions and three Coolify checks fail
before implementation; 19 image/stock checks now pass. A disposable Bun package
installation also passes its installed verifier against the real offline Codex
binary and the local Claude version check. On pushed head `b8f30695e`,
[image job 121471946536](https://github.com/link-assistant/hive-mind/actions/runs/40292596806/job/121471946536)
also built both packaged images and passed the installed verifier during build
and after boot. That verifies the stock gate on actual images; auth/history,
contamination, upgrade and restored-state lifecycle gates remain open.

Image pins also need protection from Hive Mind's idle and command-triggered
updater. Three regressions show that disabling Claude's own updater alone still
allows both attested CLIs to be replaced. All three image definitions now set
the existing `HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE=claude,codex`; four tests verify
the pinned tools stay excluded while other tools and non-image defaults retain
their update behavior. Operator overrides and runtime version re-attestation
remain separate admission concerns.

A real child-process fixture also reproduces inherited parent environment in
the stock probe, and version commands using the parent home. All gate children
now receive only a minimal environment, disposable homes and a fresh working
directory. The Codex probe explicitly uses file credential storage in its
disposable home. The regression starts its parent with synthetic state only;
no operator credentials need to be read to test inheritance. It fails before
the fix and passes afterward, alongside the 21 stock and pin-preservation tests.

This remains a partial guard: effective alternate homes, all native discovery
surfaces, quarantine, deployment validation and
adversarial races during filesystem mutation still need implementation.

### Authentication copies: reproduced and still present

`prepareScopedCodexHome()` calls `syncFileIfPresent()` for `auth.json`;
that helper uses `fs.copyFile()`. Codex then receives the scoped `CODEX_HOME`.
Rotation writes change the scoped copy; `/limits` and later tasks read the base.
Repeated preflight copies the stale base over a newer scoped credential.

Mounting the base file into a container cannot fix that additional copy. Nor
does replacing the copy with a file symlink prove the required contract:
atomic rename replaces the link, logout can remove it, and login can recreate
a private file. A file bind mount holds an inode rather than a live directory
entry, and the kernel rejects replacing/unlinking that mount point.

The offline probe intentionally asserts these failures in the current
production code. Its successful exit means **defect reproduced**, not fixed.
The Docker directory-mount control demonstrates a filesystem primitive only;
it does not isolate config, coordinate refresh or certify vendor histories.

## Upstream research and design constraints

### Claude paid access and billing dates

The authenticated OAuth profile supplies entitlement/status/trial information;
the incident profile did not supply a paid Max end date. OAuth access-token
expiry, refresh-token expiry, usage reset, account creation and subscription
creation cannot establish the paid period end.

Anthropic's [cancellation documentation](https://support.claude.com/en/articles/8325617-cancel-your-pro-or-max-subscription)
says cancellation takes effect at the current billing period's end. Therefore
cancelled renewal and paid access can coexist.

An existing primary implementation,
[CodexBar's Claude provider](https://github.com/bcharleson/codexbar/blob/main/docs/claude.md),
documents cookie-authenticated
`GET https://claude.ai/api/organizations/{org_id}/subscription_details`.
It distinguishes `next_charge_at`/`next_charge_date` renewal fields from
`plan_ending_at`/`plan_ending_before` expiration fields, preferring explicit
termination, and preserves calendar-only dates. OAuth/cookie account and
organization identities must match before and after enrichment. Missing
billing data must leave the end date unknown.

This is a separate web-session authority, not an OAuth profile capability. No
browser cookies were extracted or provider accounts changed during this work.
The research identifies a possible exact-date source but does not claim it is
integrated. A production implementation needs an explicitly configured,
account-checked billing source or an authority that supplies this information.

### Codex and concurrent refresh

[Official authentication documentation](https://learn.chatgpt.com/docs/auth#credential-storage)
places file auth under `CODEX_HOME`; file/keyring/auto/ephemeral storage choices
are not a supported independent shared-auth-home switch. Other state/config
paths must also be inspected, including SQLite home overrides.

The exact requested separation is already reported in
[openai/codex 15410](https://github.com/openai/codex/issues/15410), closed as
not planned, and the copied-home documentation gap is tracked in
[15502](https://github.com/openai/codex/issues/15502). A
[new evidence report](https://github.com/openai/codex/issues/15502#issuecomment-6408380122)
adds the bounded reproductions, real CLI mount behavior, workaround limits and
code-level interface suggestion to the existing issue rather than opening a
duplicate. Its exact submitted text is retained under `experiments/issue-3785/`.

For the observed version, [file storage source](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/login/src/auth/storage.rs)
uses `$CODEX_HOME/auth.json`; deletion removes that path, and file saving opens
with create/truncate. The [authentication manager](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/login/src/auth/manager.rs)
has a process-local refresh guard and reread. A JS lock in Hive Mind cannot
serialize a vendor process that never acquires it. A refresh lock must cover
canonical reread, provider exchange and atomic commit for **all** refreshers.

A fourth bounded probe uses two actual Codex 0.164.0 processes sharing one
**directory-mounted** auth store and a local synthetic OAuth provider. The
provider holds responses until both processes submit generation G0, then accepts
one exchange and rejects the other as consumed-token reuse. G1 is committed to
the shared store. This reproduces the exchange race independently of credential
copies and file-mount behavior; it does not verify a coordination fix. Networking
is disabled, no real credentials are mounted, and request bytes are not logged.
The CLI's model requests intentionally receive a local 503; command success is
not the probe's assertion. See `evidence/concurrent-refresh.log` and
`experiments/issue-3785/probe-concurrent-codex-refresh.sh`.

The pinned CLI does have integration hooks that warrant an adapter experiment.
Its [command-backed provider auth](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/login/src/auth/external_bearer.rs)
invokes a configured helper and constructs API-key-mode auth from its output.
That helper could participate in a broker lock, but native ChatGPT account
semantics, logout/login and canonical history are not established by that hook.
The [app-server external-auth bridge](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/external_auth.rs)
can request refreshed ChatGPT tokens from a client. Using it would require a
different execution adapter: the pinned [CLI dispatcher](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/cli/src/main.rs)
explicitly rejects remote app-server mode for `codex exec`, which Hive Mind
currently drives. The installed CLI's generated login schema explicitly marks
external ChatGPT-token login as internal and unstable. A bounded offline
experiment nevertheless verifies one client's external callback: the actual
app-server receives synthetic G0, a local provider returns 401, the external
owner atomically commits G1, and the CLI's next model request carries G1.
No native `auth.json` is created. The synthetic tokens retain the same account
and user identity across rotation. The model deliberately returns 503; the
assertions concern the callback and request credential, not successful inference.
See `probe-appserver-auth.mjs`, `inspect-codex-auth-hooks.sh`, and their retained
structural outputs. Neither hook is integrated into production execution;
concurrency, login/logout and full history remain unverified through this path.
These interfaces make a broker a research avenue; they do not establish that
the full contract is impossible or already supported by this launcher.

Claude has an existing open report for
[credential symlink replacement and concurrent state loss](https://github.com/anthropics/claude-code/issues/76561).
It is corroborating upstream evidence, not a real Claude refresh reproduction
in this workspace. Claude also documents an existing shared refresh lock;
the Codex race must not be generalized to Claude. Its actual cross-container
behavior must still be tested in the required packaged-image matrix. The
[versioned six-tool storage inventory](storage-inventory.md) records distinct
config/data/runtime interfaces and the remaining verification gaps.

Router already documents coordinated backend refresh and a redacted usage API
in its [primary README](https://github.com/link-assistant/router). Its newer
Rust usage schema and HTTP tests informed the adapter. That does not make an
explicit experimental Router selection a substitute for the requested default
native contract, and it does not prove unmanaged host CLIs participate in its
refresh lock.

## Required implementation still open

The stock CLI storage interfaces above do not establish a way to satisfy the
entire default contract by changing paths alone. A supported per-tool storage
adapter, participating CLI change, or broker architecture is needed. Existing
upstream reports document this constraint; no approved upstream adapter was
verified here. This is an external constraint on the native integration, not
evidence that the remaining launcher work is complete or impossible.

The following implementation sequence remains required:

1. Establish each tool's supported canonical auth/history adapter. Inventory
   Claude, Codex, OpenCode, agent, Qwen and Gemini storage, including archives,
   indexes, databases and resume metadata. All native readers/writers, including
   the host, must use the same authority. Remove all credential copies only
   when the real replacement is validated; do not install a symlink workaround.
2. Resolve daemon-side mount sources from inspected root mounts for host-socket
   and nested-daemon deployments. Validate source identity and effective paths
   before admitting task code, after preflight, and during resume. Unsafe,
   redirected, missing or changed authority must fail closed.
3. Serialize refresh across processes/containers with canonical-generation
   reread before exchange, atomic commit, and safe logout/re-login. Preserve the
   surviving good generation before any real recovery or cleanup. No live
   credential repair was attempted in this workspace.
4. Create fresh per-task config/extension storage, with discovery in disposable
   task-owned state. Share neither root config nor writable catalogs. Enforce
   the root Playwright-only baseline across effective home/profile, managed,
   alternate, legacy, synced and marketplace surfaces. Compare stock `.system`
   bytes against a pristine instance of the same pinned CLI version.
5. Replace full-home restore/watch with an explicit migration allowlist. Keep
   auth, full conversation evidence and approved Playwright; quarantine
   extension state without traversing unsafe links or losing newer auth.
   Reject malformed/contaminated root state before deployment or launch.
6. Define and validate explicit alternative-backend authority and audit/storage
   contracts. Suppress vendor credential mounts, prohibit silent fallback, and
   retain full conversation discovery/resume independently of request logs.
7. Add required real-image tests and make release/deploy promotion depend on
   them. Cover root plus two concurrent tasks, different capabilities,
   synthetic provider rotation, repeated preflight, hostile path overrides,
   wrong daemon sources, atomic replacement/logout/re-login, success/failure/
   kill/removal/restart/redeploy/cleanup, upgraded contaminated state and CLI
   upgrades. Skips or unsupported layouts cannot count as passing promotion.

The local Docker daemon can run small probes with `--cgroup-parent /` but the
workspace has no packaged Hive Mind release images. Those images exceed 30 GiB
extracted and the container memory limit is 2.92 GiB. Small Alpine probes are
not evidence that release-image or nested-daemon gates passed. The missing
gates need an adequately provisioned runner after the contract exists.

See [the acceptance inventory](requirements.md) for the mapping of every
requirement to implementation and verification status.

## Reproduction and verification

```sh
# Automated default-suite regressions, synthetic credentials and local HTTP only
node --test tests/issue-3785-limits.test.mjs tests/issue-3785-router-limits.test.mjs tests/issue-3785-router-admission.test.mjs tests/issue-2571-usage-limits-cache.test.mjs
node tests/limits-display.test.mjs
node tests/codex-capability-preflight.test.mjs
node --test tests/issue-3785-audit-inputs.test.mjs tests/issue-3785-audit-admission.test.mjs tests/test-issue-2190-agent-config-audit.mjs

# These reproduce defects; successful exit does not mean canonical auth is fixed
node experiments/issue-3785/probe-auth-copy.mjs
bash experiments/issue-3785/probe-file-mount.sh
bash experiments/issue-3785/probe-codex-storage.sh
bash experiments/issue-3785/probe-concurrent-codex-refresh.sh

# Rebuild the synthetic browser fixture
node experiments/issue-3785/render-display.mjs
```

The Codex Docker probe mounts the installed static Linux CLI read-only into
network-disabled Alpine containers, uses synthetic API-key login, limits PIDs
and data memory, and removes both containers and fixtures. It verifies the
specific kernel `EBUSY` logout failure against the directory-mounted control.
It does not exchange real OAuth refresh tokens.

Before changing production code, the display tests failed, rotation cache tests
failed, catalog ownership test failed, Router selection tests failed, and the
verbose redaction and malformed-response tests failed with synthetic sentinel
values. Retained logs show those failures. The focused limits/cache/Router
tests pass (40 tests). Existing Router isolation, routing, sidecar and hardening checks
also pass after the admission change.
Full-suite/static-check results and current-head CI are recorded in the PR.

Local validation: the default run was interrupted while starting file 500;
the first 499 files had completed successfully. The retained fail-fast runner
log and `run-default-remainder.mjs` verify the interrupted file, all remaining
files and the new updater test: all 702 selected files passed across both runs.
The subsequent environment regression and related stock/updater checks pass
all 22 cases; the actual disposable package probe also passes with that fix.
Final static-check and newest-head CI results are recorded in the PR. The
queue suite passes all 71 assertions. The retained failure outputs reproduce
both the downloaded queue assertion and the later local pending-request race.
The four original storage/copy probes and later stock, callback and package
probes completed and cleaned up. These checks do not verify the unfinished
canonical-storage contract.

The real pinned Codex also exposed a separate stock-gate bypass: a synthetic
admin skill under `/etc/codex/skills` was discovered alongside all five pristine
system skills, and the gate admitted it. Stock file hashes alone cannot attest
the complete native catalog. The retained `native-catalog-before.log` records
that actual failure; the 14 malformed/unapproved catalog tests also failed
before the change. Admission now requires one error-free result for the
requested directory and exactly the five pinned names, private paths, enabled
flags and system scopes, without duplicates or plugin associations. The real
contaminated probe is rejected after the fix; the actual installed-package
probe still accepts pristine discovery. All 15 catalog cases and 46 related
stock, admission, environment and updater checks pass. This verifies the
disposable installed-runtime probe; complete production effective-path and
lifecycle attestation remains open.

The production Docker builder also reproduced a daemon namespace defect:
an auth source at `/operator/.codex/auth.json` inside the root container was
passed unchanged to the host daemon, whose actual backing source had a different
path. The retained `mount-namespace-before.log` records the assertion before
launch. Fresh production launches now compare source device/inode/type values
with a read-only, network-disabled task-image probe. A mismatch can be translated
through the root container's most specific bind/volume mapping, then must pass
the same probe. The bounded mountinfo reader handles partial kernel reads.
Unverifiable sources refuse launch and release acquired service leases. Missing
images retain the detached pull lifecycle. Set `HIVE_MIND_DOCKER_MOUNT_TRACE=1`
for constant stage diagnostics without paths or daemon output.

The actual host-socket probe verifies direct backing, rejects a private root
layer path, and verifies translated auth/session mounts plus a task history write
into the disposable host directory. All 18 mount tests pass; the surrounding
13-file isolation/Router/catalog run passes 56 top-level cases, including the
existing scripts' internal assertions. These use synthetic data and a small
Node image. They verify fresh-launch backing, not native CLI refresh, atomic
replacement, complete history, root/two-task lifecycle, nested-daemon behavior,
effective-path changes or resume. Those acceptance criteria remain open.

PR image verification now requires `docker-pr-verify-mount-backing.mjs` after
the existing regular/DinD checks. It imports the installed package inside each
actual image and uses the host socket or the image's nested daemon respectively.
Two concurrent, bounded Node tasks read synthetic auth and write separate session
files; the gate verifies those writes from the root and host, then cleans up.
Its two local unit tests verify completion and cleanup after success and peer
failure. Actual image execution still needs newest-head CI. This gate exercises
filesystem backing only; native CLI refresh/history and release/deployment
promotion requirements remain unfinished.

Run 40304694014 on `b0ae348d1` skipped Docker checks: incremental detection
recognized image definitions but not the installed branch source or new gate
scripts. A real-detector regression reproduces the source-only skip. Detection
now includes package source/dependencies, startup and verification inputs; the
existing change-range and untested-head suites still pass. Image execution
requires another newest-head run after this correction.

The conventional-home audit also admitted clean homes while explicit
`CLAUDE_CONFIG_DIR` or `CODEX_HOME` selected contaminated directories. Nine
initial regression cases fail before the fix. The audit now includes both
conventional and selected roots in its pre-repair snapshot and final re-audit.
Unsafe linked ancestors/files, malformed state and concurrent edits prevent
all repairs, including unrelated conventional-home changes. Changed selectors
reject repair/admission after asynchronous logging. Tests verify protected
synthetic auth/history identities and unrelated settings survive safe repairs.
Production solve/hive/bot admission and installed-runtime verification pass the
selected environment explicitly; library fixture callers remain independent of
the parent environment. These checks cover the existing known surfaces under
the selected roots, not every managed/search path or canonical storage identity.

Local managed layers exposed another clean-home bypass: all eleven initial
negative cases admitted contaminated or unsafe system configuration. The audit
now checks Claude's managed settings, JSON drop-ins and managed MCP file, plus
Codex system defaults, legacy managed configuration, requirements, adjacent
hooks and admin payload directories. Reads are asynchronous, bounded and use
descriptor identity checks. Linked paths, malformed/oversized documents,
concurrent edits and changed selectors prevent repair/admission. Managed
capability findings refuse launch without rewriting administrator files;
permission restrictions, MCP identity constraints and executable-policy rules
remain byte-for-byte intact. An audit-only invocation reports the findings.

The real offline pinned Codex probe confirms a synthetic system MCP is
discoverable with a clean user home; launcher admission rejects it while
preserving the managed file's bytes and inode. Two further negative tests
reproduced admission of a Claude policy helper and a Codex required config
server. Both can deliver new managed settings after the local file audit;
admission now refuses these unattested dynamic sources without executing a
helper, fetching remote policy or changing their policy files. All eighteen managed
cases pass, including preservation and unsafe-input cases. These are local
file-layer checks, not attestation of cloud-delivered policy, OS policy stores,
all plugin/search paths or native auth/history identity. Those broader
requirements remain unfinished.

Locations and policy distinctions were checked against the pinned
[Codex configuration loader](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/config/src/loader/mod.rs),
[requirements types](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/config/src/config_requirements.rs),
[MCP constraints](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/protocol/src/mcp_policy.rs)
and Anthropic's [managed settings reference](https://code.claude.com/docs/en/managed-settings).
Dynamic policy sources were checked against the pinned
[config-server type](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/config/src/config_server.rs)
and Anthropic's [policy-helper reference](https://code.claude.com/docs/en/settings-reference#policyhelper).
The actual managed/native probe ran on Linux; the other platform path defaults
are not an integration-verified policy-store implementation.

![Synthetic before and after limits layout](evidence/display-comparison.png)
