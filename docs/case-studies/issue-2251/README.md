# Case study: recovering Telegram commands with broken or invisible separators

Issue: [link-assistant/hive-mind#2251](https://github.com/link-assistant/hive-mind/issues/2251)

Prepared: 2026-09-14 UTC

## Executive finding

The screenshot records a `/claude` command followed by a GitHub issue URL and no visible bot response. The raw text copied into issue #2251 contains U+00A0 NO-BREAK SPACE between `/claude` and the URL:

```text
/claude[U+00A0]https://github.com/G-Ivan-A/hybrid-Intelligence-lab/issues/577
```

That exact text is reproducibly accepted by the current source tree when the Telegram update reaches the application: the text fallback recognizes `claude`, the tool alias becomes `--tool claude`, and the URL is valid. Therefore the screenshot alone does **not** prove that U+00A0 caused the observed silence. No Telegram update, deployed commit SHA, application log, or bot privacy/admin state was attached, so the historical production root cause cannot be selected from the transport, deployment, authorization, or runtime hypotheses.

The investigation did find a related deterministic defect. The shared parser used `\s` to remove the command prefix but only the literal ASCII space to split the remaining arguments. A visually identical Unicode space between a URL and an option produced one invalid argument:

```text
expected: ["https://github.com/.../577", "--verbose"]
before:   ["https://github.com/.../577[U+00A0]--verbose"]
```

An invisible Unicode format character such as U+200B between `/claude` and the URL also caused command extraction and argument parsing to disagree, losing the `claude` tool selection. The fix establishes one Unicode-aware command-prefix grammar and one Unicode White_Space tokenizer for every argument-bearing Telegram command. Format characters are accepted only at the command boundary; inside a URL they remain available to the existing URL recovery layer, which removes them without splitting a repairable URL.

## Evidence boundary

### Established facts

- The issue body's separator is U+00A0, encoded as UTF-8 `C2 A0`.
- The screenshot shows the command at 12:06 AM and no reply in the captured viewport. Its date, time zone, Telegram update, and server result are absent.
- The linked source issue was opened at 2026-09-14 17:03:00 UTC and contains seven architecture requirements plus a 101,206-byte, 544-line dialogue attachment.
- Issue #2251 was opened at 17:25:26 UTC. It had no comments when collected.
- The exact one-separator payload succeeds through the current local parser.
- A second Unicode separator between the URL and an option fails on pre-fix code and passes after this change.
- A U+200B command boundary previously lost the per-tool alias and now passes through command detection, parsing, and alias selection consistently.

### Unknown facts

- Whether Telegram delivered the photographed message to the bot.
- Whether its `entities` array contained a `bot_command` entity at offset zero.
- Which Hive Mind version and commit were deployed.
- Whether the bot was running, authorized for the chat/topic, stopped, or rejecting old messages.
- Whether privacy mode was enabled and whether the bot was a group administrator.
- Whether an error occurred after parsing but outside the screenshot.

These unknowns are intentionally not converted into a claimed root cause.

## Preserved evidence

The raw GitHub API responses, both issue comment lists and timelines, the authenticated screenshot download, and the full linked dialogue are in [`data/`](data/). Checksums and provenance are recorded in [`data/README.md`](data/README.md). Focused research notes are in [`research-sources.md`](research-sources.md). The failing pre-fix assertion and post-fix diagnostic output are in [`evidence/`](evidence/).

The screenshot was checked for the PNG signature before visual inspection; it was not an HTML authentication response. Empty comment/timeline arrays are preserved rather than omitted because the absence of follow-up evidence is itself relevant.

## Timeline

| Time (UTC)                       | Event                                                                                                         | Significance                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-01                       | [PR #1208](https://github.com/link-assistant/hive-mind/pull/1208) merged                                      | Added a text-based fallback when Telegraf's entity-based command handler misses a delivered command.                         |
| 2026-04-16                       | Commit `fd3c76cc`                                                                                             | Added `/claude`, `/codex`, and other per-tool solve aliases.                                                                 |
| 2026-07-07                       | Commit `11dab3c9`                                                                                             | Recovered long options joined directly to GitHub URLs.                                                                       |
| 2026-09-04                       | [PR #2200](https://github.com/link-assistant/hive-mind/pull/2200) merged                                      | Added conservative GitHub URL recovery for invisible characters, confusable punctuation, wrappers, and entity-path mistakes. |
| 2026-09-14 17:03:00              | [G-Ivan-A/hybrid-Intelligence-lab#577](https://github.com/G-Ivan-A/hybrid-Intelligence-lab/issues/577) opened | Created the high-value issue that the photographed command was intended to solve.                                            |
| Unknown date/time zone, 12:06 AM | Telegram screenshot                                                                                           | Shows `/claude <URL>` and a link preview, but no bot reply in the viewport.                                                  |
| 2026-09-14 17:25:26              | [Issue #2251](https://github.com/link-assistant/hive-mind/issues/2251) opened                                 | Preserved the command as text, exposing U+00A0, and requested this investigation.                                            |
| 2026-09-14 17:27:51              | [PR #2252](https://github.com/link-assistant/hive-mind/pull/2252) cross-referenced                            | Created the implementation vehicle for the investigation and fix.                                                            |

The screenshot time cannot safely be placed before or after the source issue timestamp because it does not show a date or time zone.

## Reconstructed processing path

```text
Telegram client
    |
    | update delivered?  <-- unknown; privacy/admin state matters here
    v
Telegraf bot.command()
    |
    | requires a bot_command entity at offset 0
    | entity absent/malformed
    v
Hive Mind text fallback
    |
    | shared Unicode command prefix
    v
shared argument tokenizer
    |
    | Unicode White_Space separates args; quotes preserve whitespace
    v
GitHub URL recovery + validation
    |
    v
requested command handler (/claude => solve --tool claude)
```

Telegram defines message-entity offsets in UTF-16 code units. Telegraf's command middleware reads the first entity and declines the handler unless it is a `bot_command` at offset zero. Hive Mind's fallback is therefore still necessary for delivered text that Telegram or a client did not entity-tag as expected.

The fallback cannot recover an update that Telegram never sends. Telegram's privacy-mode documentation says administrators receive all group messages, while a privacy-enabled non-administrator receives a limited set including commands explicitly meant for it. If an unusual separator prevents Telegram from classifying text as such a command, making the bot an administrator or disabling privacy mode and re-adding it is the operational workaround. This is an inference to test with the missing raw update, not a conclusion about the photographed event.

## Requirements inventory

### Issue #2251

| ID  | Requirement                                                             | Result in this PR                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Download all related logs and data into `docs/case-studies/issue-2251`. | GitHub issue data, comments, timelines, screenshot, linked issue, linked comments/timeline, and full attachment are preserved with checksums. No production log existed in the issue.                                                               |
| R2  | Perform a deep case study and search online for additional facts.       | This analysis traces Telegram, Telegraf, local parsing, URL recovery, and deployment boundaries; primary sources are listed separately.                                                                                                             |
| R3  | Reconstruct the event sequence.                                         | The known timeline and its explicit timestamp gap are above.                                                                                                                                                                                        |
| R4  | List every requirement.                                                 | This matrix lists #2251; the linked payload's requirements are inventoried below so its value is not reduced to a URL.                                                                                                                              |
| R5  | Find root causes for each problem.                                      | Confirmed code causes and unresolved production hypotheses are separated below.                                                                                                                                                                     |
| R6  | Propose solutions and plans for each requirement/problem.               | Parser, fallback, diagnostic, deployment, and follow-up plans are documented below.                                                                                                                                                                 |
| R7  | Evaluate known components/libraries.                                    | Built-in Unicode properties, Telegraf, and the existing Hive Mind recovery layers are evaluated below.                                                                                                                                              |
| R8  | Add debug/verbose output if evidence is insufficient.                   | Existing default-off `TELEGRAM_BOT_VERBOSE` tracing already records revealed hidden characters, entity data, update metadata, bot/webhook state, and rejection branches. A targeted capture protocol is provided rather than duplicating telemetry. |
| R9  | Report reproducible upstream issues when another project is at fault.   | No upstream defect is established. A speculative Telegram/Telegraf report would lack the required raw update and reproduction; report criteria are documented below.                                                                                |
| R10 | Apply the requirement to every affected code path.                      | Solve/hive/task/split/fix/auth/merge/models/language/terminal-watch/stop argument parsing now shares the Unicode-aware grammar; reply/stop URL extraction preserves boundaries before cleanup; `/merge` and `/stop` join the entity-miss fallback.  |
| R11 | Complete all work in one PR.                                            | Implementation, regression, release changeset, evidence, and analysis are in PR #2252.                                                                                                                                                              |

### Requirements carried by the linked issue

The bot command was intended to preserve and act on these source requirements, not merely open a web page:

1. Prefer deep, iterative, evidenced analysis without inflating the meta-model.
2. Define a bounded return path after an `A-TRACE` failure, comparing machine retry with a `G-human` gate.
3. Make operation/process identifiers unambiguous outside their taxonomy files.
4. Map BCREQ to BABOK RADD and accurately scope the model as the G-Ivan-A/Mango project model until universality is tested.
5. Evaluate an `A-MEMORY` project-memory artifact and structured execution logs, or defer it with a concrete trigger.
6. Describe a meta-process for improving `AGENTS.md`/`SKILL.md` contracts from run evidence.
7. Add glossary cross-validation for ambiguous boundary cases, using a Golden Set and/or a `G-mach` rule.

The source definition of done also requires justified outcomes for points 2-7, targeted edits to three taxonomy areas, anti-inflation compatibility, absolute artifact links, passing validators, and transition to review. The attachment adds the deliberation behind these requirements, including bounded retry, human gates, namespaced identifiers, project memory/SSOT, context transfer, and negative glossary cases. Archiving the attachment prevents the expensive reasoning behind the concise issue from being lost.

## Problems and root causes

| Problem                                                                   | Status                                       | Root cause                                                                                                                                            | Resolution or next step                                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P1. No visible reply in the screenshot                                    | Unresolved historical event                  | Required production evidence is absent. The exact U+00A0 payload works locally, so assigning the failure to that byte would be false precision.       | Use the capture protocol below on the affected deployment.                                                       |
| P2. A visually normal command contains a non-ASCII separator              | Confirmed input ambiguity                    | Chat clients and copied rich text can carry Unicode whitespace that renders like U+0020. Screenshots cannot preserve the distinction.                 | Reveal hidden characters in diagnostics and test an explicit Unicode corpus.                                     |
| P3. URL and option become one argument                                    | Confirmed code defect                        | Prefix removal used regex whitespace, but the manual tokenizer split only on `char === ' '`.                                                          | Tokenize every Unicode `White_Space` code point outside quotes.                                                  |
| P4. Invisible command boundary loses `/claude` alias                      | Confirmed code defect                        | Three command extractors used different boundary regexes; argument parsing stripped the visible command but retained U+200B.                          | Centralize command/mention/boundary parsing and accept `Cf` only at that boundary.                               |
| P5. Other Telegram commands drift from the fix                            | Confirmed design defect                      | `/merge`, `/models`, `/language`, `/terminal_watch`, and `/stop` had private tokenizers; task/fix had private name regexes.                           | Route argument-bearing handlers through the shared parser/prefix helper and tokenize before destructive cleanup. |
| P6. Entity-based dispatch can silently miss delivered text                | Known integration boundary                   | Telegraf intentionally depends on Telegram's leading `bot_command` entity. Text that is delivered without that entity does not reach `bot.command()`. | Keep the text fallback, now including link-bearing `/merge`, and retain entity diagnostics.                      |
| P7. Privacy mode may prevent application-side recovery                    | Conditional transport limitation             | Application code cannot parse a message that Telegram does not deliver. Whether this occurred is unknown.                                             | Make the bot an administrator or disable privacy mode and re-add it; then capture the raw update.                |
| P8. Screenshot-only evidence cannot distinguish parser, policy, or outage | Confirmed observability gap in this incident | There is no update ID, entity list, deployed SHA, handler trace, or server error paired with the screenshot.                                          | Use existing default-off verbose traces and record deployment identity for the next reproduction.                |

## Implemented solution

### One boundary grammar

`telegram-command-text.lib.mjs` parses a command, optional `@bot` mention, and its boundary. It accepts:

- all characters in Unicode `White_Space`, including U+00A0, U+0085, U+2007, and U+202F;
- Unicode format characters (`General_Category=Cf`) only between the command/mention and its arguments;
- end of text for argument-free commands.

Requiring a real boundary also prevents a text prefix such as `/solve!` from being misclassified as `/solve` by the fallback.

### One argument tokenizer

The shared parser iterates Unicode code points and treats Unicode `White_Space` as a separator only outside single or double quotes. This preserves existing chat-friendly quoting while covering tabs and visually ambiguous spaces. It does not split on arbitrary format characters inside arguments: the GitHub URL recovery module can safely remove those characters from one URL token, while splitting the token could make recovery impossible.

### One path for all argument-bearing commands

- `/solve`, `/do`, `/continue`, per-tool aliases, `/hive`, `/task`, `/split`, `/fix`, and `/auth` already called the shared parser and inherit the correction.
- `/merge`, `/models`, `/language`, `/terminal_watch`, and `/stop` now call the shared parser/prefix helper instead of maintaining private tokenizers.
- task/fix command-name selection and the entity fallback use the same prefix helper.
- Reply and `/stop` URL extraction establish Unicode whitespace boundaries before removing non-printable characters, preventing U+0085 from fusing adjacent tokens.
- `/merge` and `/stop` expose their registered handlers to the fallback because both consume GitHub links.
- Error reporting now derives the command with the same extractor rather than splitting only on ASCII space.

### Release behavior

A patch changeset is included. No package version is edited directly because this repository's Changesets release workflow owns version bumps and changelog generation.

## Components and alternatives

| Component/approach                          | Decision                    | Reason                                                                                                                                                                                                       |
| ------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ECMAScript Unicode property escapes         | Use                         | `\p{White_Space}` and `\p{Cf}` express the policy directly, ship in the required Node runtime, and avoid another dependency.                                                                                 |
| Telegraf `bot.command()`                    | Keep as primary dispatch    | It is the framework-native path when Telegram supplies a correct leading command entity, but it cannot cover a missing/malformed entity alone.                                                               |
| Hive Mind text fallback from #1207          | Keep and extend to `/merge` | It recovers delivered command text after entity dispatch misses it and provides an entity-warning signal.                                                                                                    |
| `github-url-recovery.lib.mjs` from #2194    | Reuse after tokenization    | It already removes format/control characters from a URL, normalizes safe confusables, and reports notable repairs. Duplicating URL rules in the command parser would create drift.                           |
| `argument-normalization.lib.mjs` from #2021 | Reuse                       | It repairs options accidentally joined directly to supported GitHub issue/PR URLs after tokenization.                                                                                                        |
| Generic shell-argument parser               | Reject for now              | Telegram commands intentionally support a small quote grammar, not shell expansion/escaping. A new parser dependency would broaden semantics and supply-chain surface without solving dispatch or transport. |
| Normalize all Unicode to ASCII up front     | Reject                      | Whole-message normalization can change quoted user content, repository names, and prose. Boundary-specific handling is more conservative.                                                                    |
| Infer `/claude` for every bare GitHub link  | Reject                      | It would trigger expensive work from ordinary conversation and cannot recover a message that privacy mode withholds.                                                                                         |

## Diagnostic protocol for the unresolved historical failure

Existing tracing is sufficient but was not captured for this incident. It remains off by default. On the affected deployment:

1. Record the deployed package version and Git commit SHA.
2. Start the bot with `TELEGRAM_BOT_VERBOSE=true` in a controlled test chat.
3. Record whether the bot is an administrator and the BotFather privacy setting. After changing privacy, remove and re-add the bot as Telegram instructs.
4. Send, separately, U+0020, U+00A0, U+2007, U+202F, U+0085, and U+200B boundary variants from the same Telegram client used in the incident.
5. Correlate the screenshot with update ID, ISO receive time, chat/topic authorization, `message.entities`, and the `raw text` line where hidden characters are rendered as `[U+XXXX]`.
6. Classify the first missing stage:
   - no update: transport/privacy/client classification;
   - update but no primary handler: entity dispatch, followed by fallback result;
   - handler rejection: old/forwarded/chat/topic/stopped policy trace;
   - parsing/validation failure: captured normalized arguments and URL-repair notice;
   - execution failure: session/error trace.
7. Repeat once with the bot as administrator or privacy disabled. A difference isolates the transport policy from application parsing.

The repository already logs entity arrays and update metadata under verbose mode, reveals hidden command characters before solve parsing, warns when the text fallback fires, prints startup webhook/privacy guidance, and traces command rejection branches. Adding a second logging switch would fragment the evidence; the missing action is to retain these existing logs with the deployed SHA.

## Upstream-report decision

No external issue was filed.

- The linked G-Ivan-A issue is the command's intended payload, not the source of the bot failure.
- Telegram delivery cannot be assessed without a raw update and privacy/admin state.
- Telegraf's leading-entity check is reproducible framework behavior, not by itself a defect, and Hive Mind already has the appropriate delivered-text fallback.

An upstream report becomes justified only if the same client, chat policy, raw text, and raw update demonstrate a mismatch with Telegram's documented entity/delivery contract, or if Telegraf fails despite a correct `bot_command` entity at offset zero. Such a report must include a minimal bot, sanitized raw update JSON, client/version, exact code points, admin/privacy state, expected versus actual behavior, and the ASCII-space workaround.

## Verification

The regression test covers:

- the exact #2251 U+00A0 payload and its code point;
- U+00A0, U+2007, U+202F, U+0085, and tab between the URL and an option;
- U+200B at the command boundary with `/claude` alias preservation;
- Unicode whitespace inside a quoted argument;
- task/fix name recognition and shared merge/models/terminal-watch parsing;
- stop/reply URL extraction when U+0085 would otherwise be deleted during cleanup;
- exposure of the exact `/merge` and `/stop` handlers used by Telegraf to the text fallback.

[`before-fix-test.log`](evidence/before-fix-test.log) preserves the failing minimum reproduction. [`after-fix-experiment.jsonl`](evidence/after-fix-experiment.jsonl) makes every hidden character visible and records the recovered commands/arguments. The reusable experiment is [`experiments/issue-2251/reproduce-command-whitespace.mjs`](../../../experiments/issue-2251/reproduce-command-whitespace.mjs).

## Remaining limitation

No application change can reconstruct a Telegram message it never receives. The parser and fallback now recover the known delivered-text variants, but closing the historical uncertainty requires one controlled production reproduction with the capture protocol above. Until then, transport/privacy, deployment age, authorization state, and runtime availability remain explicitly unranked hypotheses.
