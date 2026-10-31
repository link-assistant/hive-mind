# Acceptance inventory

Sources: [original issue](https://github.com/link-assistant/hive-mind/issues/3785),
[canonical storage feedback](https://github.com/link-assistant/hive-mind/issues/3785#issuecomment-6399598109),
and [global baseline feedback](https://github.com/link-assistant/hive-mind/issues/3785#issuecomment-6403814424).
No required sub-issues were returned by the API. The two subsequent automated
inline review findings and their review were read and are tracked below.

“Open” below means unfinished in PR 3786. A reproduction of a defect is evidence
for investigation, not verification of a fix. The native storage interface is
constrained by upstream support; remaining local implementation is still open.

| ID  | Requirement                                                                                                           | Implementation/evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| O1  | Claude auth errors separate from system metrics even without a profile; Codex parity                                  | `limits.lib.mjs`, `issue-3785-limits.test.mjs`, browser comparison                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Implemented                                                                                                                 |
| O2  | Free/cancelled detection when available; no inference from missing auth                                               | Authenticated account flags override disk labels; cancellation retains paid entitlement; tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Implemented for published profile fields                                                                                    |
| O3  | Investigate active task versus expired `/limits`                                                                      | Generation comparison in operator comment, failed-task log 359–362, production copy probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Root cause reproduced; underlying auth defect open                                                                          |
| O4  | Research exact Claude Max paid expiration, including unofficial sources                                               | OAuth versus cookie billing analysis, CodexBar primary implementation and official cancellation docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Research complete; optional billing-source integration open                                                                 |
| O5  | Download logs/images and provide complete case study, timeline and solutions                                          | Compressed sanitized logs, validated PNGs, manifest, README, probes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Implemented investigation artifacts                                                                                         |
| O6  | Prefer existing components; report upstream where appropriate                                                         | Existing reports plus new reproduction report on Codex 15502; Router usage API adapter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Research and upstream report complete; native adapter open                                                                  |
| A1  | Default same host-backed auth and full history for every supported tool, through root/task/effective scopes           | Agent/OpenCode now project their native XDG data directories; legacy Claude/Codex mounts and Codex auth copies remain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Partial: two data projections; complete six-tool contract open                                                              |
| A2  | No auth copies/snapshots, one rotating authority; preserve good surviving credentials                                 | Synthetic probe shows A/B divergence and stale overwrite; no live credential mutation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Open: production copy remains                                                                                               |
| A3  | Config private; home/profile/repo/preflight overrides cannot redirect state                                           | Agent/OpenCode task identities reject changed XDG data, config/cache/state overlap and OpenCode private auth/DB selectors; experimental native Qwen OAuth selector separates private config roots and rejects a second credential authority; full CLI and other backends remain open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Open                                                                                                                        |
| A4  | Atomic rename, delete/recreate, logout/re-login operate on canonical storage                                          | Agent/OpenCode production-planned directory mounts pass atomic replacement, deletion/recreation and peer-write Docker probes; native host resume passes; pinned native Qwen manager/client reads and 14 OAuth writer/failure controls pass locally with a synthetic fetch stub, including consumed-token metadata rewrites and non-rotating success; actual CLI/factory provider-refusal controls pass locally and in CI run 41051640593                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Partial: synthetic Docker and native host probes; full lifecycle open                                                       |
| A5  | Cross-process/container refresh lock and generation reread before exchange                                            | Native exec race reproduced; packaged Linux lock has ten regressions; two-container external-callback experiment verifies one exchange after lock/reread, including owner removal; pinned native Codex coordination passes in CI; pinned native Qwen stable-lock/intent coordination passes 14 actual OAuth writer controls locally and in CI run 41051640593 across private config roots; metadata-only rewrites preserve consumed-predecessor uncertainty; native Claude host controls pass ordinary concurrent/paused-response cases, but owner death reproduces uncertain G0 reuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Open: native experiments and synthetic controls; production, full CLI/backends and complete lifecycle unfinished            |
| A6  | Correct daemon-namespace sources for host-socket and nested Docker                                                    | Fresh-launch device/inode probes and bind/volume translation; actual synthetic host-socket probe passes direct/mapped/rejected paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Partial: both daemon mount gates pass on e95fd3a6f; native full lifecycle open                                              |
| A7  | Fail closed before execution, after preflight and resume; detect changed paths                                        | Fresh-launch backing and audit selectors checked; Agent/OpenCode recheck selected data identity; Codex history I/O errors refuse resume/recovery; actual native missing-auth request refusal passes both modes/peers in run 40376400046; all eight provider overrides refuse and stock metadata remains usable in run 40384255301; downloaded native CLI also passes TUI refusal and all eight alternate-constructor/compatibility controls locally; stale identity publication during a legacy-login replacement reproduced, twelve focused writer tests pass after login/mode repair, nine actual before controls reproduce four stale publications, full CLI positive passes in run 41064060039; complete production admission open                                                                                                                                                                                                                                                                                                                              | Partial                                                                                                                     |
| A8  | Explicit experimental opt-out with declared authority, validated storage/audit, no vendor mounts or fallback          | Router selection/mount suppression and `/limits` no-fallback adapter; resource-only extra arguments; actual new/reused sidecar environment and canonical writable audit-volume admission before task-token issue; 51 new regression controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Partial: declared sidecar storage checked; audit contents, complete conversation storage and external-backend contract open |
| A9  | Full transcripts, archives, projects, indexes/DBs survive all lifecycle paths; peers discover/resume                  | Pinned Agent/OpenCode native host probes resume prior messages; actual Claude completes and resumes a shared transcript after both private roots are disposed, with prior messages verified in the next model request; actual Qwen completes/resumes the same session and retains prior messages/transcript via a shared runtime after private-root disposal, with private-runtime negative controls; Codex preserves concurrent recovery writes, four native rollout formats, archives and native writer-lock identity; real CLI cross-scope writer exclusion and archive/read/unarchive/resume pass; native index patch compiles, passes 20 upstream/index tests and actual named read/resume after both private homes are disposed in run 40376400046; maintenance admission has 12 actual-function controls and passes full-CLI disposal; native prompt-history crate passes 14 controls and 12 upstream tests in run 40384255301; actual downloaded native TUI healthy/refusal and legacy controls pass after descendant cleanup; full lifecycle matrix absent | Open                                                                                                                        |
| A10 | Real root + two-task Docker tests per tool, fresh/upgraded, CLI operations, provider stub refresh, repeated preflight | Four bounded probes are retained; complete matrix absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Open                                                                                                                        |
| A11 | Required packaged release/deploy gates, supported daemon layouts, no skip-as-pass                                     | Branch-package image/daemon checks now precede main publication and publishing requires success; complete storage/lifecycle gates remain absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Open                                                                                                                        |
| A12 | `/limits` uses selected canonical/backend authority and labels stored JWT versus fresh HTTP                           | Native Claude secure-storage precedence/empty/NFC selection; generation-aware cache, stored label, Router adapter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Partial: native canonical-identity validation depends on A1/A7                                                              |
| B1  | Root Claude/Codex Playwright MCP only; no global add-ons/instructions/hooks/agents/commands                           | Known instructions/hooks/profiles/agents block admission; Playwright command spoofing and both conventional Claude state paths are checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Partial: complete global baseline remains open                                                                              |
| B2  | Stock `.system` compared against pristine same pinned CLI                                                             | Pinned manifest and installed gate pass during build and after boot of both actual images on b8f30695e, run 40292596806                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Partial: upgrade/deployment gates and later changes need validation                                                         |
| B3  | Validate all effective global/config/search paths, legacy/synced/marketplace/hook manifests                           | Known user/effective and managed file layers checked; explicit Claude cloud pins and synced-payload cleanup; native Codex profile-v2 files and system/compaction/realtime prompt keys checked; catalog selectors and startup .env refuse with protected state preserved; actual model-request controls verify prompt/catalog/redirected-skill discovery; unsafe/changed inputs reject admission; full native discovery remains open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Partial                                                                                                                     |
| B4  | Fresh per-task config/capabilities, no writable root/template mounts; snapshots not future defaults                   | Fresh private Codex homes outside the operator tool directory; semantic plugin removal and same-repository isolation regressions pass; full lifecycle/template guarantees remain open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Partial                                                                                                                     |
| B5  | Disposable task-owned discovery; no global install prerequisite                                                       | Normal and degraded Codex discovery allocate fresh task state; failed preflights clean up; synthetic concurrent and explicit pre-execution disposal regressions pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Partial: execution cleanup awaits canonical history/SQLite projection                                                       |
| B6  | Preserve canonical auth/history while isolating config, using actual CLI write behavior                               | Native interface constraint and Docker evidence documented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Open                                                                                                                        |
| B7  | Allowlist migration of persisted full homes; preserve auth/history/Playwright, exclude extensions                     | Legacy restore/watch unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Open                                                                                                                        |
| B8  | Final image/restored state validate before admission; contaminated/unsafe state fails launch/deploy                   | Launcher rejects known remaining findings; Coolify runs installed read-only runtime validation before startup/setup; full storage/image attestation remains absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Partial                                                                                                                     |
| B9  | Image boot/restart rehydration tests with fresh and contaminated state                                                | Installed stock-runtime gate added to image builds and container verification; fresh/contaminated restored-state matrix absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Open                                                                                                                        |
| B10 | Two concurrent different-capability tasks isolated; root stays clean through full lifecycle                           | Pinned native Codex Docker discovery probe passes with concurrent different-capability checkouts, distinct homes and unchanged operator state; full execution/refresh/cleanup lifecycle remains open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Open                                                                                                                        |
| B11 | Test mount/config writes, overrides, symlinks/snapshots; safe auto-fix and malformed-state rejection                  | Audit regressions reject malformed JSON/TOML, links, growth and stale plans; semantic TOML/profile-v2 repairs preserve unrelated settings/protected state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Partial: complete discovery, mutation safety and image gates open                                                           |
| B12 | Canonical refresh/history lifecycle integration, CLI-upgrade and both-daemon release/deploy gates                     | Depends on A1–A11 plus B1–B11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Open                                                                                                                        |

| Review | Requirement                                                                  | Implementation/evidence                                                                         | Status                                                       |
| ------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| R1     | Remove clear-text subscription logging derived from credentials (CodeQL 309) | Constant success diagnostic; regression verifies credential/provider sentinels never enter logs | Implemented; fresh analysis on faf96022a marks finding fixed |
| R2     | Compare the complete generated Router URL (CodeQL 310)                       | Exact unique `base_url` line assertion replaces substring matching                              | Implemented; fresh analysis on faf96022a marks finding fixed |

The original issue must remain open and the pull request must remain unmerged
until the open and partial rows have implementation and verification evidence.

The new Gemini experiment establishes nine native factory/retained-client stale
header defects and an opt-in read repair, including independent roots and private
scope disposal. A second stage coordinates the inspected refresh, cache-publication
and logout entrypoints. The expanded 26 native controls cover concurrency,
uncertainty, recovery, directory identity, authorization-code publication, initial
manual/browser login and current-generation revocation. External browser launch
and provider transports are synthetic; the real native callback and SDK execute.
Canonical account metadata and native callbacks have a further experimental
repair, including stale user-info refusal and same-process login after logout.
The combined local stage passes 41 writer/account controls, 11 canonical reads,
nine legacy reproductions and 30 selected plus 30 unselected config/constructor/
request controls. Native API-key SDK dispatch reproduces a bypass before the
new request admission. A full CLI TLS control now completes native OAuth
inference, and a further pinned stage preserves native conversation discovery
and resume after private-home disposal. Native linked-transcript attacks refuse,
and bounded storage controls include malformed/truncated refusal, four concurrent
writers and stale rewrite preservation. The preceding conversation stage passes Node 24 CI
41111156696 on `37bcddb6ebed4bf9331ba425ea62739fec397691`, including actual
native discovery/resume and malformed/truncated refusal. Parsed-record admission and the retirement stage also pass Node 24 CI
41116035148 at `4a6be5dfb`. That stage
preserves startup-only, expired and explicitly deleted native conversations in a
canonical archive while keeping their native active-listing behavior. Native
writer initialization holds a per-conversation kernel lease, so peer retention
skips a live conversation and peer deletion reports it busy. Five real CLI
retirement controls and 29 bounded storage controls pass, including owner-death
lease recovery, stale archive refusal and unsafe archive/lease paths. Further
local stages add native archive discovery and exact-identifier resume without mutating
the audit generation, concurrent resume exclusion and native opaque-ID compatibility.
Explicit `--session-file` imports from canonical records and private JSONL/legacy
JSON exports preserve their source and publish a new private canonical session;
fresh discovery/resume retains the prior user/model content. Their 45 storage
controls, seven actual CLI archive refusals, three native import/disposal controls
and nine unsafe-import refusals pass Node 24 CI 41121912110 at `946ed6e82e07426dbe6ebd224c7675796dcbe339`. Complete
archive indexes and child/artifact lifecycles remain open. Canonical alternate
backends, complete history, all writers/lifecycle and production installation
remain unfinished. These experiments do not complete A1–A12. See
`experiments/issue-3785/native-gemini/README.md` and
`evidence/native-gemini-reads-controls.txt` for the exact verified boundaries.

The next local Gemini stage rejects invalid UTF-8 before JSON decoding and
preserves offloaded native tool-output files after private-home disposal.
A strict full CLI control first completes real shell execution and inference,
then reproduces the lost artifact. With the artifact stage, fresh resume and
native read_file recover its complete content; eight unsafe-artifact CLI
controls refuse before further inference. All 65 bounded storage controls,
nine native truncation/masking/legacy controls and 41/30/11 authentication
regressions pass locally. This stage and the following degraded-blob stage pass Node 24 CI
41132983002 at `d0b4f6b4701f018b2f0d2d577dd8183bed3f12e3`; all 433
native diagnostic files and the complete log are preserved locally. The
remaining full-history/lifecycle/production criteria stay open.

The following local stage preserves native degraded multimodal bytes through
private-home disposal. The strict before control first offloads and reads a real
PNG successfully. All 31 native controls pass after checked immutable canonical
publication, including seven new-process reads, native JSON/SVG/UTF-16/audio-text
behavior and valid uppercase MIME / unpadded base64. Malformed data and padding,
unsafe storage, foreign paths and publication collisions refuse without a private
fallback. A separate complete CLI control uses no native export instrumentation:
after successful native context degradation and inference, it reproduces loss
before repair. After repair, fresh resume/read_file sends the retained PNG in
its new tool response with the original workspace image removed.
They do not complete A1 or the remaining history/lifecycle/production criteria.

The next native Logger experiment reproduces loss of successfully written prompt
history and named checkpoints after private-home disposal, plus stale cached
reads after a peer write. Canonical checked transactions coordinate prompt reads,
appends and session message IDs; a checkpoint event journal preserves replacement,
deletion and recreation generations. Its 30 scenarios / 36 bounded native process
results pass locally, including four concurrent writers preserving all 40 prompts
and 24 unsafe-storage/publication refusals. These native API controls do not
establish interactive startup/error admission, prior-private-state migration,
shell command/Git checkpoint/plan/tracker/task storage, child/subagent lifecycle,
interrupted first publication, all backends or production installation. Fresh
Node 24 CI run 41137763744 passes these controls at
`8f2ec5c8e5118f4a135681810108048519cea19c`; the remaining A1–A12 criteria stay open.

A further native recovery stage reproduces interrupted first publication in
five data families before repair. Fifteen forced-death controls now recover
the original bytes/device/inode across private-home disposal; twenty unsafe
evidence controls refuse without changing publication or protected files.
A live journal replacement first fails on the draft, then passes with generation
revalidation before publication and evidence removal. All 36 results / 71 bounded
native processes pass locally. Fresh source application produces the exact
tested manager/CLI/helper bytes and passes its native crash/read control. See
`evidence/native-gemini-publication-controls.txt` for pins and boundaries.
Malformed/incomplete intent creation, unjournaled staging, append interruption,
full CLI/UI crash admission, physical power loss and the remaining full-history/
lifecycle/backend/production requirements stay open. Exact-head Node 24 CI
41137763744 passes this recovery stage; all 586 diagnostic files and the complete
log are preserved. These controls do not complete A1–A12.

The next interactive shell-history stage reproduces private-home loss, cached
peer navigation and swallowed writes in the actual native hook. Synchronous
checked appends retain a complete command audit, while fresh reads derive native
100-command deduplicated navigation. All 22 scenarios / 28 bounded native process
results pass locally, including four concurrent writers, 122 retained audit
events, multiline UTF-8 data, prompt separation and eleven unsafe-storage/schema
cases. Two draft failures show invalid command data being accepted on navigation
and submission; validation now precedes publication inside the same locked append.
A separate complete TUI control uses a real PTY and TLS-verifying synthetic
provider without native export or SDK instrumentation. It first executes a shell
command, then reproduces failed recall in a fresh healthy TUI after private-home
disposal. After repair, up-arrow and enter recall and execute that command.
The complete TUI also reproduces invalid command data reaching provider dispatch
before its asynchronous loading effect reports failure. A checked startup read
now precedes rendering and inference. Seven unsafe-audit TUI controls refuse before any additional provider inference
or shell execution and preserve protected evidence. Fresh source application
verifies the same eight manager/CLI/helper files and passes its native hook
lifetime control. Complete interactive failure/crash admission, migration,
Git/plan/tracker/task storage, child/subagent lifecycle, alternate backends,
rollover and production installation remain unfinished. Fresh exact-head Node 24
CI run 41143418875 passes the shell stage at 39e2e0d75. See
`evidence/native-gemini-shell-controls.txt` for exact boundaries.

A further native tracker stage reproduces loss of healthy created/updated tasks
and the same loss through the complete CLI's actual create/update/get/list tools.
Canonical prompt transactions retain every task generation with native
project/session separation and schema checks. Checked native startup admission
addresses a reproduced malformed-task dispatch gap. Two further controls
reproduce closure and cycle decisions committing after a peer changes a
dependency; an async operation context validates all observed task revisions
inside the locked publication without replacing the native business validators.
See `evidence/native-gemini-tracker-controls.txt` for exact local verification and
limits. The Node 24 tracker job passes in run 41146984829 at 3aff67264d; its
sibling credential job times out, and the job partition requires fresh CI.
Private-state migration, remaining full-history and lifecycle requirements,
all backends and production integration remain required.
These experimental stages do not complete A1–A12.

A further native Git checkpoint stage first reproduces lost healthy snapshots
after private-home disposal, executable private configuration filters, and
acceptance of a missing earlier acknowledged commit. Real native Git objects
now use checked canonical data-only storage, while executable configuration and
derived refs/index remain private. Serialized native operations reread the head,
admit every acknowledged object graph and retain each published generation.
Twenty-one native scenarios and seven complete CLI startup refusals pass locally;
the complete CLI also retains its initialized head across disposal and resume.
Fresh reconstruction checks all fourteen resulting manager/CLI/helper files.
See `evidence/native-gemini-git-controls.txt` for exact boundaries. Terminal/ACP
restorable-tool metadata, private-state migration, interrupted object publication,
physical power loss, all backends and production installation stay unfinished.
The Git adapter remains experimental. All four Node 24 Gemini jobs subsequently
pass in run 41150101913 at 40db3a6e3c0, including the independent history-job
partition and credential controls. A further service-reuse stage reproduces the
actual terminal's second GitService refusing startup's initialized repository;
all 24 Git scenarios / 28 native process results pass after sharing its checked
repository seal, and fourteen fresh-source files match byte for byte.

The next terminal metadata stage reproduces `/restore` losing a healthy native
checkpoint after complete private-home disposal. Native conversation, tool,
prompt and Git metadata now append as checked canonical data-only generations.
The actual fresh terminal restores the original conversation and untouched
companion file, preserving native automatic tool replay without further
inference. A second strict regression reproduces damaged metadata allowing the
approved edit; the actual native writer is now awaited before approval and
execution, and registered metadata is checked before dispatch. Healthy restore,
live refusal and fresh startup refusal pass. All 26 API scenarios / 30 native
process results pass, and fourteen fresh-source stages reproduce seventeen
tested manager/CLI/helper files. See
`evidence/native-gemini-restorable-controls.txt` for exact pins and limits.
These remain experimental changes. All five Node 24 Gemini jobs pass at
5abb937c55b2 in run 41153757108. At that stage, actual
ACP writing, child/subagent writers, remaining task/plan memory, migration,
interrupted/power-loss durability, all backend lifecycle coverage and production
installation remain required. A1–A12 remain unfinished.

The following actual ACP control reproduces missing checkpoint writes, model
history not changing after restore, the restored first prompt being lost
on a third CLI reopen because native history coalesces it with filtered session
context, and restore listings showing `Unknown` for saved names and tools.
Separate pinned repairs await the ACP writer, apply the native chat/recorder
restore, preserve actual turn boundaries and list validated checkpoint metadata.
Native `replace`, automatic edits, cancellation and both restore listings pass
locally. Three-process restore,
prior audit byte retention, live/startup schema refusals and original unselected
behavior pass locally; eighteen fresh stages reproduce seventeen tested native
files, and that reconstruction passes the full three-process restore cycle.
See `evidence/native-gemini-acp-restore-controls.txt`. All six Node 24 Gemini
jobs pass at b44086a4cd2d, including the four strict ACP before controls and
eighteen-stage reconstruction; see `evidence/ci-b44086a4c-gemini.txt`.
Remaining ACP/child writers, plan/task memory, interruption/power loss, migration,
all-backend lifecycle and production integration remain unfinished.
This evidence does not complete A1–A12.

The terminal's own third-process resume reproduces the same coalesced context/
prompt loss. Preserving its actual checkpoint turn boundaries makes the strict
interactive-resume test pass, with both prior private homes deleted, the prior
audit retained and native tool replay preserved. Nineteen checked history stages
reconstruct seventeen identical native files. See
`evidence/native-gemini-terminal-reopen-controls.txt`. A separate strict automatic
startup-prompt control reproduces model dispatch before native resume completes.
Selected prompt admission now awaits actual resumeChat. The fresh twenty-stage
package passes automatic/manual prompts, ACP restore, live/startup metadata
refusals and native shell-history controls. See
`evidence/native-gemini-terminal-resume-controls.txt`. Both terminal stages need
fresh Node 24 CI. Failed/interrupted resume and the full A1–A12 lifecycle and
production installation remain unfinished.

Both actual headless native engines separately reproduce successful edit and
inference without canonical checkpoint acknowledgement. Registering their
schedulers with the native pre-edit writer makes a headless edit, fresh ACP
restore and third headless resume pass after two private-home disposals.
Both engines preserve prior audit bytes and pass live/startup metadata refusal
and no-selector native behavior. Twenty-one checked stages reconstruct seventeen
identical native files; see `evidence/native-gemini-headless-controls.txt`.
Fresh Node 24 CI, remaining native writers, complete lifecycle and production
integration are still required; A1–A12 remain unfinished.

A further actual terminal resume control refuses a session still owned by a
healthy ACP process, without provider requests or project/metadata/audit changes.
Typed input stays disabled on the repaired package. After the owner is stopped
and reaped, another fresh CLI resumes original history with prior audit intact.
This ownership conflict also refuses on the preceding nineteen-stage package;
it adds lifecycle evidence without a new source repair. See
`evidence/native-gemini-resume-refusal.txt`. Fresh Node 24 CI, delayed/interrupted
resume, physical power loss and complete production integration remain open.

Actual native root delegation and child editing also reproduce canonical
recording refusal: native recursive mkdir creates an unsafe `0755` child
directory. Checked `0700` allocation retains both complete root/child transcripts,
and fresh discovery/root resume retains the child result after private-home
deletion. Unsafe permissions, symlink and parent replacement refuse before child
inference or edits. Twenty-two checked stages reconstruct seventeen identical
native files; see `evidence/native-gemini-subagent-history.txt`. Child checkpoint/
restore, concurrent writers, other agent definitions, task/plan memory, complete
lifecycle and production installation remain open. This partial A7/A9 evidence
does not complete A1–A12. All eight workflows pass at the preceding ACP baseline
`b44086a4cd2d`; see `evidence/ci-b44086a4c.txt`. Newer terminal, headless and child
repairs still require fresh CI.

The terminal/headless/child source stages now have exact-head Node 24 evidence:
all six Gemini jobs pass at `533cc3a20c01`, with nine strict before failures and
fresh twenty-two-stage reconstruction (`evidence/ci-533cc3a20-gemini.txt`).
This supersedes the preceding pending-CI statements for those stages only.

A7/A9 also have a strict actual CLI audit-rollback reproduction and process-local
repair: an older valid record previously removed the real tool call/result
while inference completed. Retained inode and byte-prefix evidence now refuses
that loss, preserving the protected complete audit and healthy project edit.
A legitimate actual discovery peer may still append metadata while the original
terminal keeps its writer claim and completes another inference. Full storage
69 and fresh twenty-three-stage reconstruction pass locally; see
`evidence/native-gemini-conversation-evidence.txt`. This new stage and admission
interruption controls still require fresh CI. Fresh-process persisted rollback
authority, publication/power loss, remaining writers and production integration
remain unfinished; A1–A12 retain their existing incomplete status.

A7/A9 streaming controls independently reproduce terminal and ACP delivery of
the final answer before audit recording refuses. A twenty-fourth checked stage
validates retained evidence before dispatch and response chunks, and settles
the dispatch promise even if failed-history cleanup also refuses. Actual
terminal and ACP now refuse before delivering that answer and promptly refuse
a second real prompt without another model request or protected-state changes.
See `evidence/native-gemini-stream-admission.txt`. Full process-persistent audit
authority, every writer and production lifecycle acceptance remain unfinished.
All eight workflows pass at the preceding pushed head `533cc3a20c01`
(`evidence/ci-533cc3a20.txt`); these newer stages require fresh exact-head CI.

A9 child-checkpoint coverage now includes actual edits from both native headless
engines, canonical pre-edit metadata, whole private-home disposal, a fresh ACP
parent restore of project and model history without inference, and third-process
resume after deleting the second home. Both complete prior root/child audit
prefixes remain retained; each control passes five assertions and seven actual
provider requests. See `evidence/native-gemini-subagent-restore.txt`. This extends
verification of existing native repairs. Direct child continuation, remaining
definitions/task memory and production lifecycle remain
unfinished; the acceptance status is still partial.

A9 concurrent-child coverage independently runs two actual generalists in both
native headless engines. A finite provider barrier proves both model requests
overlap before either response. Both real edits, results, distinct checkpoints
and separate full conversations survive whole private-home disposal and fresh
parent discovery/resume. All three preceding audit prefixes remain retained;
unselected controls preserve private recording without canonical writes. See
`evidence/native-gemini-concurrent-children.txt`. Direct child continuation,
shared-file conflicts, all agent definitions/task memory, publication/power loss
and full production lifecycle remain open; A9 remains partial.

A9 native plan coverage now reproduces acknowledged plan loss after whole
private-home disposal, then verifies actual write/resume/read/replace against canonical
plan documents and full journal generations. Native filesystem controls include
peers, concurrent documents/generations, session/project separation and unsafe
read/write refusal; Plan Mode policy stays restricted to the current directory.
See `evidence/native-gemini-plans.txt`. Interrupted multi-artifact publication,
all filesystem writers, other task/memory paths and production installation
remain unfinished; A9 remains partial. Gemini's preceding corrected suites and
child-edit restore cycles pass all six jobs at `e51270e05e88`; concurrent-child
coverage passes all six at `8f9ca8867a`. See
`evidence/ci-e51270e05-gemini.txt` and `evidence/ci-8f9ca8867-gemini.txt`.

A9 plan publication now has strict native API owner-death reproductions for
first and replacement documents. A twenty-sixth source stage records checked
durable intent and recovers complete journal/file generations after synchronized
intent, journal and document publication boundaries. All 59 recovery/refusal
assertions and 30 storage assertions pass locally; fresh reconstruction compares
17 identical native files. See `evidence/native-gemini-plan-publication.txt`.
The complete actual CLI independently reproduces both pre-repair failures and
passes twelve assertions across the same six interruption boundaries. After
whole-home disposal, real native resume/read_file delivers the complete UTF-8
plan while preserving every full generation and preceding audit. Partial intent,
power loss, remaining writers/task memory
and full production lifecycle remain unfinished. This is partial A9 evidence.
All eight workflows pass at the preceding `8f9ca8867a` concurrent-child head;
the new plan stages require their own fresh exact-head CI.

A9 partial-proof coverage separately reproduces incomplete visible publication
JSON in the complete actual CLI before repair, for first and replacement plans.
Stage 27 publishes only a complete checked proof and validates its exact temporary
alias during recovery. Fourteen native API kill/recover cases, thirteen unsafe
cases and two live proof substitutions pass locally. Fresh CLI resume and real
write/read retries retain complete generations; incomplete unreferenced staging
is retained. See `evidence/native-gemini-atomic-publication.txt`. Physical power
loss, orphan cleanup, durable rollback authority, other writers and production
lifecycle remain unfinished; A9 remains partial.

At `ec03c083d0e0`, seven of eight workflows pass, including compiled native Codex,
739 default test files, both integration files and installed host/nested Docker
controls. Gemini's final auth regressions reject an omitted exact plan-stage
manager pin; all preceding native plan/lifecycle controls pass. The pin repair
passes all 82 local auth assertions. See `evidence/ci-ec03c083.txt` and
`evidence/ci-ec03c083-gemini.txt`; the repair and new interruption stages require
fresh exact-head CI. These results leave the open production criteria unchanged.

All eight workflows subsequently pass at `de9c6444692e`, including the corrected
Gemini auth pin and complete CLI atomic-proof controls. The full compiled Codex
executable, all 94 auth-build files and all 2,731 Gemini artifacts are preserved
and reviewed; no positive control contains an assertion failure. See
`evidence/ci-de9c6444.txt` and `evidence/ci-de9c6444-gemini.txt`. These results
precede the following package/image installation changes.

The native Gemini adapter now has an installation path in the published npm
artifact. Its reproducible recipe checks all 449 upstream files and 23 changed
native outputs, preserves the original package, and publishes a verified sibling
generation. Both image variants activate the package-manager bin link from the
installed artifact; runtime admission checks the native bytes before its version
probe. Actual packaged native auth and restore controls pass locally. See
`evidence/native-gemini-package.txt`. Fresh image CI, default canonical selectors,
private configuration, migration and full lifecycle remain unfinished. This
installation step does not complete A2/A9 or remove the production Codex auth
copy.

A12 now also has explicit native Codex selector coverage in the production
limits reader. Before repair, twelve strict controls reproduce private-home
fallback despite CODEX_AUTH_HOME; further controls reproduce private endpoint
redirection, unsafe cached success and a second independent credential
authority. Bounded descriptor-based reads and repeated cache admission now
pass all 45 selected/legacy/Router assertions. See
`evidence/codex-limits-authority.txt`. Default canonical selection, daemon-backed
identity, migration and production credential-copy removal remain open; this
selected-mode repair does not complete A12 or A2.

A2 selected-mode capability discovery also now preserves the explicitly
selected native credential authority. Seven strict reproductions expose task
credential snapshots and discovery through unsafe/conflicting selected storage
or an unverified command. All 50 related controls pass after descriptor-based
admission and native command checks; selected scopes contain no auth.json copy.
See `evidence/codex-preflight-authority.txt`. Default selection, unselected
production copies, runtime leases and complete lifecycle integration remain
open; A2 is not complete.

A2 selected-mode Formal AI configuration now also preserves the native Codex
credential authority. Ten new regressions reproduce credential snapshots,
conflicting/unsafe storage, logout and writer admission gaps; all 53 related
assertions pass after repair. The actual Formal AI 0.355.7 configuration writer
passes two-task replacement/disposal/logout controls with synthetic credentials
and no inference. The same installed-module control is required in both image
checks, pending new CI. See `evidence/formal-ai-codex-authority.txt`. Default
selection, unselected copies and complete backend/history lifecycle remain open.

A3/A9 selected native Codex SQLite admission now has actual before evidence for
private sqlite_home, command-line sqlite_home and log_dir redirection. Six
filesystem guard tests pass, and the release recipe pins that guard in an
identical 34-file inventory produced by two fresh checkouts. Both platform and
installed-command CI now require explicit refusal before database creation.
Compiled after verification, operation leases, canonical database file binding
and default production selection remain due; these changes do not complete
A3/A9. See `evidence/codex-sqlite-authority.txt`. The first optimized x64 compile
finished, then packaging rejected Cargo's internal hardlink. Nineteen packaging
controls and a tiny actual Cargo build pass after the bounded-copy repair;
optimized runtime verification remains due (`evidence/native-codex-cargo-handoff.txt`).

A2 metadata discovery now also uses the actual task environment and selected
binary, admitting native bytes before execution. Six new regressions and all
41 related Node tests pass. The actual development CLI returns compiled metadata
with malformed private configuration and absent credentials through --bundled;
the unbundled control refuses that configuration. Installed-package CI requires
the same reader with native byte admission, pending a fresh run. This does not
complete default selection, production credential-copy removal or the complete
lifecycle. See `evidence/codex-model-catalogue-admission.txt`.

A3/A9 also now has an actual native SQLite alias reproduction: symlink and
hardlink controls apply native migrations to an outside database despite the
selected canonical directory. Four new filesystem regressions fail before
startup file admission; all eleven native unit tests and 36 related packaging
and Node tests pass after repair. A fresh pinned checkout reproduces the new
34-file inventory. Both platform and installed-command CI require actual alias
refusals, pending the next run. This does not establish per-operation leases or
complete A3/A9. See `evidence/codex-sqlite-binding.txt`.

A12 also has 32 pending-response and cache-generation controls. Seventeen
initial regressions and twelve later direct-reader regressions fail before
repair. Both providers now discard retired responses after logout/replacement,
and old completions preserve newer cache entries. Selected Codex storage is
admitted again before publication, including coalesced callers. All 96 related
Node tests/file targets pass; HTTP is mocked and filesystem mutations are real.
See `evidence/limits-request-generation.txt`. Default canonical selection,
coordinated refresh and the other open A12/A2 criteria remain unfinished.

The first compiled SQLite configuration after probe at 6282876d fails: native
core admission refuses, but app-server bootstrap catches that error and loads
defaults before creating canonical databases. The exact preserved binary
reproduces both sqlite_home and log_dir fallback locally; its explicit native
strict-config control refuses all three conflicting cases before creation.
The adapter now selects that policy automatically for selected canonical
history. Two fresh checkouts reproduce its 35-file inventory, and 36 related
packaging/Node controls pass. Compiled automatic-selection verification remains
due. See `evidence/codex-sqlite-fallback.txt`; A3/A9 remain unfinished.

A12 additionally revalidates storage after asynchronous credential hashing.
Thirteen regressions fail against the preceding module: unchanged auth bytes
otherwise let changed root permissions/private auth injection survive cache
hits, dispatch and direct/cached response publication. A coalesced caller also
otherwise receives G0 after admitting an atomic G1 replacement. All thirteen
and 109 related Node tests/file targets pass after repair. See
`evidence/limits-storage-revalidation.txt`. This does not establish an operation
lease or complete the remaining default authority and lifecycle requirements.
