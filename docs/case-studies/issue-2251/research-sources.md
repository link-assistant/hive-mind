# Primary-source research notes

Sources checked on 2026-09-14 UTC. Facts are paraphrased; links point to the authoritative specification or project source.

## Telegram

- [Telegram Bot API: MessageEntity](https://core.telegram.org/bots/api#messageentity): `bot_command` is an entity type, and entity offsets/lengths are measured in UTF-16 code units. This explains why framework dispatch is based on both raw text and entity metadata.
- [Telegram Bot Features: Privacy Mode](https://core.telegram.org/bots/features#privacy-mode): bot administrators receive all group messages. Privacy-enabled bots receive a limited set that includes commands explicitly meant for them. Telegram instructs operators to re-add a bot after disabling privacy mode.

## Telegraf

- [Telegraf v4 command middleware source](https://github.com/telegraf/telegraf/blob/v4/src/composer.ts): the command handler examines the first text entity, requires `type === 'bot_command'` and offset zero, and otherwise calls the next middleware. It derives the payload from the entity length. Hive Mind's later text fallback is therefore complementary rather than redundant.

## ECMAScript and Unicode

- [ECMAScript lexical grammar: white space](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-white-space): ECMAScript white space includes Unicode Space_Separator code points, which covers U+00A0, U+2007, and U+202F.
- [Unicode Character Database PropList](https://www.unicode.org/Public/UCD/latest/ucd/PropList.txt): the `White_Space` property also includes controls such as U+0009 TAB and U+0085 NEXT LINE. The implementation uses this property directly so its policy is explicit and testable.

## Hive Mind prior work

- [Issue #1207](https://github.com/link-assistant/hive-mind/issues/1207) and [PR #1208](https://github.com/link-assistant/hive-mind/pull/1208): introduced text fallback and entity diagnostics after a command reached middleware without activating Telegraf's command handler.
- [Issue #2021](https://github.com/link-assistant/hive-mind/issues/2021): led to recovery of long options joined to GitHub issue/PR URLs.
- [Issue #2194](https://github.com/link-assistant/hive-mind/issues/2194), [PR #2200](https://github.com/link-assistant/hive-mind/pull/2200), and its [case study](../issue-2194/README.md): introduced conservative URL repair and hidden-character diagnostics. Issue #2251 reuses that layer after correcting token boundaries.

## Interpretation

The standards establish what entities, offsets, privacy behavior, and Unicode properties mean. They do not establish what happened in the photographed deployment. Claims about non-delivery or missing entities therefore remain conditional until a raw Telegram update and matching server trace are captured.
