## Summary

In credentials-only mode (0.22.3), the `authorization` rule (and the overlapping `context` finding) does not end the value at a Markdown code-span backtick. When the header is written inside a code span, the closing backtick becomes part of the value:

- `<value>`, `$TOKEN` and `${TOKEN}` stop matching `credentialPlaceholder()`, so documentation placeholders are masked;
- the closing backtick is consumed by the redaction, which breaks the Markdown around it (`` `Authorization: token [REDACTED] (and ...``).

#151 fixed the same boundary for the `context` rule on `key=value` pairs; the `Authorization:` path in `src/context.js` was not changed.

## Reproduction

```js
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';
const s = createSyncSanitizer({ credentialsOnly: true });
for (const input of [
  'Authorization: token <value>',            // kept (correct)
  '"Authorization: token <value>"',          // kept (correct)
  '`Authorization: token <value>`',          // masked: "`Authorization: token [REDACTED]"
  '`Authorization: Bearer <token>` header',  // masked: "`Authorization: Bearer [REDACTED] header"
  '`Authorization: Bearer $TOKEN`',          // masked
  '`Authorization: Bearer ${TOKEN}`',        // masked
]) console.log(JSON.stringify(s.sanitize(input).text));
```

`inspect()` reports `rule: 'authorization'` and `rule: 'context'` findings whose value is `` <value>` `` (8 characters, including the backtick).

Real-world impact: the hive-mind 2.40.1 release note contains
``Fix the credential sanitizer masking the scheme word instead of the credential in `Authorization: token <value>` (and any other scheme)``, and the publication sanitizer rewrites it to ``... in `Authorization: token [REDACTED] (and any other scheme)``. hive-mind's `tests/issue-3445-release-notes-not-masked.test.mjs` fails on its default branch because of this.

## Root cause

`authorizationDelimiter()` in `src/context.js` stops at whitespace, C0 controls, DEL, `"`, `'`, `\` and `,`, but not at `` ` ``. `authorizationEnd()` therefore extends the token over the closing backtick, and the anchored `credentialPlaceholder()` test (`^(?:\$\{...\}|\$NAME|<[^<>]+>|\[REDACTED\])$`) no longer matches the value.

## Suggested fix

Either of these:

1. End an Authorization value at a backtick. RFC 7235 `token68` (`ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/"`, then `=` padding) cannot contain a backtick, so this cannot shorten a real bearer/basic credential:
   ```js
   function authorizationDelimiter(char, code) {
     return code < 32 || code === 127 || /[\s"'`\\,]/.test(char);
   }
   ```
   (`authParams` already handles quoted `auth-param` values separately.)
2. Or, more narrowly, when the `Authorization:` match is inside a code span (an odd number of backticks earlier on the same line), stop at the closing backtick, the way `markdownRange()` does for #151.

Add the samples above to the regression suite, plus a real token inside a code span (`` `Authorization: token ghp_...` ``), which must stay masked and keep its closing backtick.

## Workaround

Downstream, with the existing `exempt(finding, text)` hook: keep an `authorization`/`context` finding only when its value is exactly a complete template (`<name>`, `$NAME`, `${NAME}`) followed by the closing backtick of a code span that opened before the header on the same line. Known secrets are never offered to the hook, so they stay masked. hive-mind applies this in `src/sensitive-data-sanitizer.lib.mjs` (link-assistant/hive-mind#4050) and will remove it when a release fixes this.
