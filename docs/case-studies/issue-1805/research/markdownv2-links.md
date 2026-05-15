# Telegram MarkdownV2 — Link Notes

Reference for the rules we follow when building inline links inside
`/merge` progress and final messages.

## Syntax

```
[label](url)
```

- `label` is plain MarkdownV2 text. Special characters
  `_*[]()~`>#+-=|{}.!`must be backslash-escaped. We pass the label through`escapeMarkdown()`/`escapeMarkdownV2()` (the helpers already in the tree).
- `url` is the literal href. Inside `url`, only `)` and `\` need to be
  escaped (Telegram's docs say `inline link or pre/code entities`).

We never call `escapeMarkdown(url)` because that would also escape characters
that are valid inside URLs (`.`, `-`, `_`, etc.) and break navigation.
Instead we run a focused replacement that only touches `)` and `\`.

## Helper used in this PR

```
escapeMarkdownLinkUrl(url)
  return url.replace(/[\\)]/g, '\\$&');
```

…matching the same trick already used for the "View" CI links in
`formatFinalMessage()`:

```js
const runUrl = run.html_url ? `[View](${run.html_url.replace(/[)]/g, '\\)')})` : '';
```

We extend it with the backslash branch for symmetry. Telegram's parser
otherwise treats a literal `\` inside a URL as an escape sequence.

## Avoiding nested link issues

Telegram does not allow nested inline links and rejects markup where the
entity overlaps another. The merge queue renders each PR reference on its
own line, so the surrounding emoji/status text never wraps the link — no
chance of nesting.

## Truncation rule

Both renderers truncate long PR titles to 35 chars and append the escaped
ellipsis (`\.\.\.`). When the title is truncated we still pass the _full_
URL — only the label is shortened — so the link still navigates to the
correct PR.
