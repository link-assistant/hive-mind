# Research Sources for Issue #1292

## Official Documentation

- [Telegram Bot API - Formatting Options](https://core.telegram.org/bots/api#formatting-options)
- [Telegram Bot API - MarkdownV2 Style](https://core.telegram.org/bots/api#markdownv2-style)

## GitHub Issues and Discussions

- [Telegraf Issue #1242: What are all the "special characters" that need to be escaped](https://github.com/telegraf/telegraf/issues/1242) - Comprehensive discussion about MarkdownV2 escaping requirements
- [Symfony Issue #42697: Escaping special characters with MarkdownV2](https://github.com/symfony/symfony/issues/42697) - Similar issue in Symfony Notifier
- [java-telegram-bot-api Issue #352: Escape characters when using MarkdownV2](https://github.com/pengrad/java-telegram-bot-api/issues/352)
- [ioBroker.telegram Issue #309: Support MarkdownV2 and escape characters correctly](https://github.com/iobroker-community-adapters/ioBroker.telegram/issues/309)

## Libraries and Implementations

- [@telegraf/entity](https://github.com/telegraf/entity) - Official Telegraf entity library with MarkdownV2 escaper
- [telegraf/entity/escapers.ts](https://github.com/telegraf/entity/blob/master/escapers.ts) - Reference implementation of MarkdownV2 escaper
- [telegram-markdown-v2 npm](https://www.npmjs.com/package/telegram-markdown-v2) - Alternative escaping library
- [telegram-escape (Rust)](https://github.com/utterstep/telegram-escape) - Rust implementation for reference

## MarkdownV2 Special Characters

According to Telegram's official documentation, these characters must be escaped with `\`:

```
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

## Escaping Implementation Reference

From `@telegraf/entity` (escapers.ts):

```typescript
export const MarkdownV2: Escaper = (() => {
  const escapables = {
    _: '\\_',
    '*': '\\*',
    '[': '\\[',
    ']': '\\]',
    '(': '\\(',
    ')': '\\)',
    '~': '\\~',
    '`': '\\`',
    '>': '\\>',
    '#': '\\#',
    '+': '\\+',
    '-': '\\-',
    '=': '\\=',
    '|': '\\|',
    '{': '\\{',
    '}': '\\}',
    '.': '\\.',
    '!': '\\!',
  };

  const toEscape = new RegExp('[' + Object.values(escapables).join('') + ']', 'g');

  return s => s.replace(toEscape, r => escapables[r as keyof typeof escapables] || r);
})();
```

## Community Discussions

- [n8n Community: Telegram node not escaping dot (.) MarkdownV2 Parsing](https://community.n8n.io/t/telegram-node-not-excaping-dot-markdownv2-parsing/113740)
- [Telegram Bugs: missed documentation about special characters](https://bugs.telegram.org/c/8003)
