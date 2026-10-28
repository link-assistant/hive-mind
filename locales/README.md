# Locale catalogs

UI and other messages live in `locales/<locale>.lino`. AI user messages, generated task instructions and continuation feedback live in `locales/prompts/`. Instructions built for a tool's system prompt live in `locales/prompts/system/`. Each directory can contain multiple Lino files; the locale header, rather than the filename, identifies the language.

`src/locale-catalogs.lib.mjs` recursively merges these files using the existing `lino-i18n` parser and compatibility aliases. It rejects conflicting keys across directories. This adapter is temporary until [lino-i18n#35](https://github.com/link-foundation/lino-i18n/issues/35) supports recursive directory loading.

Builders use `promptText(key, params)` with the work locale, independently of the UI locale. Existing translations are retained. Missing translations fall back to the English template; the extracted catalogs reuse translated lines where available. Add or update a translated key alongside its English key when changing prompts. Exported string constants remain English for compatibility; runtime builders resolve them using `localizePromptConstant`.

Use `{{parameterName}}` placeholders. Interpolation runs once, preserving inserted issue text, paths, `$&`, and braces literally. Single braces in shell commands and JSON are literal. Keep commands, JSON field names, marker tokens and other protocols unchanged; connection probes explicitly use English where their response is a protocol check.

The extraction scripts in `experiments/issue-3837-*` record the one-time migration, not a build step. The prompt corpus regression checks 24 complete English outputs from six backends, with default and optional/continuation profiles, against the pre-extraction hashes.

Live feedback, status updates, finalization hints, base-branch interventions, and automatically generated issue instructions are in `prompts/live.en.lino`. The live-output corpus in `experiments/issue-3837-live-prompt-corpus.mjs` checks their English compatibility without starting tools or polling.
