#!/usr/bin/env python3
"""Rewrite the release-process section and add the 'code is not a changelog'
rule to docs/CONTRIBUTING*.md (issue #2402)."""
import re

DOCS = {
    'en': ('docs/CONTRIBUTING.md', '### AI Agent Configuration', """1. When a PR with changesets is merged to main, the Release workflow runs `changeset version` and commits the version bump, the updated CHANGELOG.md and the consumed `.changeset/*.md` files **directly to main** as `github-actions[bot]`
2. The same run publishes the package to NPM and creates the GitHub release
3. No "Version Packages" or `release/*` pull request is created: a PR per release added one more PR and one undeletable branch for every version, and a failed run left a stale release PR behind (issue #2402). If a repository rule ever rejects the push, the release fails with the rule's output; fix the rule, do not add a release PR

### The Code Is Not a Changelog

Release history lives in `.changeset/*.md`, the generated `CHANGELOG.md`, GitHub releases, commit messages and code comments. Everything a user reads at runtime describes **what the software does now**. That covers `--help` and usage screens, option descriptions, console output, Telegram bot replies and `src/locales/*.lino`, and the comments, issues and commits the tool posts.

We do not accept code that:

- explains what changed: "old behavior", "the default in newer versions", "now does X", "no longer does Y", "the legacy script has been promoted", "renamed from", "New in vX.Y", "What's new" banners or release notes
- tags a user-facing text with the issue or pull request that introduced it, such as "(issue #1234)", "(#594)" or "Reference: https://github.com/link-assistant/hive-mind/issues/1234"

Write what the option or message does today. Put the history in the changeset, the reason in a code comment, and the issue link in the comment or test that pins the behaviour. Deprecation notices are current guidance, so they stay: they name the replacement ("deprecated; use `--isolated screen`") and do not tell the story of the change. Diagnostic log lines may cite the issue that documents a known failure mode, because that is a troubleshooting pointer, not release history. `tests/no-changelog-in-ui-2402.test.mjs` enforces this for help text, option descriptions, locales and GitHub-posted reports.

"""),
    'ru': ('docs/CONTRIBUTING.ru.md', '### Конфигурация AI-агентов', """1. Когда PR с changesets сливается в main, рабочий процесс Release запускает `changeset version` и коммитит повышение версии, обновлённый CHANGELOG.md и использованные файлы `.changeset/*.md` **напрямую в main** от имени `github-actions[bot]`
2. Тот же запуск публикует пакет в NPM и создаёт релиз GitHub
3. PR «Version Packages» или `release/*` не создаётся: PR на каждый релиз добавлял ещё один PR и неудаляемую ветку для каждой версии, а упавший запуск оставлял висящий release PR (issue #2402). Если правило репозитория отклонит push, релиз завершится ошибкой с выводом правила; исправляйте правило, а не добавляйте release PR

### Код — не журнал изменений

История релизов хранится в `.changeset/*.md`, сгенерированном `CHANGELOG.md`, релизах GitHub, сообщениях коммитов и комментариях в коде. Всё, что пользователь читает во время работы программы, описывает **то, что программа делает сейчас**: экраны `--help` и usage, описания опций, вывод в консоль, ответы Telegram-бота и `src/locales/*.lino`, а также комментарии, issue и коммиты, которые публикует инструмент.

Мы не принимаем код, который:

- объясняет, что изменилось: «старое поведение», «по умолчанию в новых версиях», «теперь делает X», «больше не делает Y», «устаревший скрипт стал командой», «переименовано из», «Новое в vX.Y», баннеры «Что нового» или заметки о выпуске
- помечает пользовательский текст issue или PR, в котором он появился, например «(issue #1234)», «(#594)» или «Reference: https://github.com/link-assistant/hive-mind/issues/1234»

Пишите, что опция или сообщение делает сегодня. Историю — в changeset, причину — в комментарий в коде, ссылку на issue — в комментарий или тест, закрепляющий поведение. Уведомления об устаревании — это текущая инструкция, поэтому они остаются: они называют замену («deprecated; use `--isolated screen`») и не пересказывают историю изменения. Диагностические строки журнала могут ссылаться на issue с описанием известного сбоя: это подсказка для отладки, а не история релизов. `tests/no-changelog-in-ui-2402.test.mjs` проверяет это для справки, описаний опций, локалей и отчётов, публикуемых в GitHub.

"""),
    'zh': ('docs/CONTRIBUTING.zh.md', '### AI Agent 配置', """1. 当包含 changeset 的 PR 被合并到 main 分支时，发布工作流运行 `changeset version`，并以 `github-actions[bot]` 身份将版本号提升、更新后的 CHANGELOG.md 以及已消耗的 `.changeset/*.md` 文件**直接提交到 main**
2. 同一次运行会将包发布到 NPM 并创建 GitHub release
3. 不会创建 "Version Packages" 或 `release/*` PR：每次发布都会多出一个 PR 和一个无法删除的分支，失败的运行还会留下过期的发布 PR（issue #2402）。如果仓库规则拒绝推送，发布会带着规则的输出失败；应修改规则，而不是添加发布 PR

### 代码不是变更日志

发布历史保存在 `.changeset/*.md`、生成的 `CHANGELOG.md`、GitHub releases、提交信息和代码注释中。用户在运行时读到的一切内容都只描述**软件现在做什么**：`--help` 和用法说明、选项描述、控制台输出、Telegram 机器人回复和 `src/locales/*.lino`，以及工具发布的评论、issue 和提交。

我们不接受以下代码：

- 解释发生了什么变化："旧行为"、"新版本中的默认值"、"现在会做 X"、"不再做 Y"、"旧脚本已升级为命令"、"由……重命名而来"、"vX.Y 新增"、"新功能"横幅或发布说明
- 用引入该行为的 issue 或 PR 标记面向用户的文本，例如 "(issue #1234)"、"(#594)" 或 "Reference: https://github.com/link-assistant/hive-mind/issues/1234"

请描述选项或消息今天的作用。历史写进 changeset，原因写进代码注释，issue 链接写进固定该行为的注释或测试。弃用提示属于当前的指导，因此保留：它们指出替代方案（"deprecated; use `--isolated screen`"），而不讲述变更的经过。诊断日志可以引用记录已知故障的 issue，因为那是排障线索，而不是发布历史。`tests/no-changelog-in-ui-2402.test.mjs` 会对帮助文本、选项描述、本地化文件和发布到 GitHub 的报告执行这一规则。

"""),
    'hi': ('docs/CONTRIBUTING.hi.md', '### AI Agent कॉन्फ़िगरेशन', """1. जब changesets वाला PR main में merge होता है, तो Release workflow `changeset version` चलाता है और version bump, अपडेट किया गया CHANGELOG.md तथा उपयोग की गई `.changeset/*.md` फ़ाइलें `github-actions[bot]` के रूप में **सीधे main में commit** करता है
2. वही run पैकेज को NPM पर प्रकाशित करता है और GitHub release बनाता है
3. कोई "Version Packages" या `release/*` PR नहीं बनाया जाता: हर release के लिए एक अतिरिक्त PR और एक न हटाई जा सकने वाली branch बनती थी, और विफल run एक पुराना release PR छोड़ जाता था (issue #2402)। यदि कोई repository rule push को अस्वीकार करता है, तो release rule के आउटपुट के साथ विफल होता है; rule ठीक करें, release PR न जोड़ें

### कोड changelog नहीं है

Release इतिहास `.changeset/*.md`, बनाए गए `CHANGELOG.md`, GitHub releases, commit messages और code comments में रहता है। Runtime पर उपयोगकर्ता जो कुछ भी पढ़ता है, वह केवल यह बताता है कि **software अभी क्या करता है**: `--help` और usage स्क्रीन, option descriptions, console output, Telegram bot के जवाब और `src/locales/*.lino`, तथा tool द्वारा पोस्ट किए गए comments, issues और commits।

हम ऐसा कोड स्वीकार नहीं करते जो:

- बताता है कि क्या बदला: "पुराना व्यवहार", "नए संस्करणों में default", "अब X करता है", "अब Y नहीं करता", "legacy script को command बना दिया गया", "से नाम बदला गया", "vX.Y में नया", "What's new" banners या release notes
- उपयोगकर्ता को दिखने वाले टेक्स्ट पर उस issue या PR का टैग लगाता है जिसने इसे जोड़ा, जैसे "(issue #1234)", "(#594)" या "Reference: https://github.com/link-assistant/hive-mind/issues/1234"

लिखें कि option या संदेश आज क्या करता है। इतिहास changeset में, कारण code comment में, और issue link उस comment या test में रखें जो व्यवहार को तय करता है। Deprecation सूचनाएँ वर्तमान मार्गदर्शन हैं, इसलिए वे रहती हैं: वे विकल्प का नाम बताती हैं ("deprecated; use `--isolated screen`") और बदलाव की कहानी नहीं सुनातीं। Diagnostic log lines किसी ज्ञात विफलता का वर्णन करने वाले issue का हवाला दे सकती हैं, क्योंकि यह troubleshooting संकेत है, release इतिहास नहीं। `tests/no-changelog-in-ui-2402.test.mjs` help text, option descriptions, locales और GitHub पर पोस्ट की गई reports के लिए इसे लागू करता है।

"""),
}

for lang, (path, next_heading, body) in DOCS.items():
    text = open(path, encoding='utf-8').read()
    lines = text.split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('#### ') and i > 40 and i < 60 and lines[i + 2].startswith('1. '))
    end = lines.index(next_heading)
    new = lines[: start + 2] + body.rstrip('\n').split('\n') + [''] + lines[end:]
    open(path, 'w', encoding='utf-8').write('\n'.join(new))
    print(path, 'updated', start, end)
