"""Add the issue #2647 Telegram configuration text to translated CONFIGURATION docs."""
import sys

T = {
    'ru': {
        'intro': '''Каждый параметр можно задать аргументом командной строки или переменной
окружения (см. раздел [Telegram-бот](#13-telegram-бот)), поэтому его также
можно хранить в `.lenv`, `.env` или в файле Links Notation по произвольному пути,
указанному через `--configuration-file <путь>` (или `HIVE_MIND_CONFIGURATION_FILE`).
Приоритет: явные параметры CLI, встроенный `--configuration`, файл конфигурации,
`TELEGRAM_CONFIGURATION`, `.lenv`, затем переменные окружения и `.env`. Явно
указанный, но нечитаемый файл конфигурации прерывает запуск.

**Рекомендуется:** храните токен и другие секреты в приватном файле `.lenv` в
рабочем каталоге (`chmod 600 .lenv`) и запускайте бота просто как
`hive-telegram-bot`. Чтобы хранить файл в другом месте, используйте
`--configuration-file /path/to/bot.lenv`.

Секреты в командной строке (`--token`/`-t` или `--configuration`/`-c` с токеном,
ключом, секретом, паролем или учётными данными) по-прежнему работают, но их видят
все пользователи и процессы на хосте через `ps` и `/proc/<pid>/cmdline`. Бот
выводит предупреждение с рекомендацией использовать `.lenv` или
`--configuration-file` и, если среда выполнения поддерживает `process.execve`,
перезапускает себя на месте без этих аргументов (тот же PID, флаги среды
выполнения, стандартные потоки, код выхода и сигналы). До перезапуска секреты
видны, поэтому отзовите токен, переданный таким образом, через @BotFather
(`/revoke`).

''',
        'env': {
            '`TELEGRAM_ALLOWED_CHATS`': ['| `TELEGRAM_ALLOWED_TOPICS` | (все) | Разрешённые пары `chatId topicId` (нотация Links) |'],
            '`TELEGRAM_AUTH`': ['| `TELEGRAM_SHOW_LIMITS` | true | Разрешить вызывающим `/solve` и `/hive` использовать `--show-limits` |',
                                '| `TELEGRAM_ISOLATION` | docker | Бэкенд изоляции (`screen`, `tmux`, `docker`); пустое значение отключает изоляцию |'],
            '`TELEGRAM_BOT_VERBOSE`': ['| `TELEGRAM_DRY_RUN` | false | Проверить конфигурацию и выйти без запуска бота |'],
        },
        'options': {
            '`--allowed-chats`': ['| `--allowed-topics` | | string | (все) | Разрешённые пары `chatId topicId` (нотация Links) |'],
            '`--task`': ['| `--fix` | | boolean | true | Включить команду /fix (--no-fix для отключения) |',
                         '| `--organize` | | boolean | true | Включить команду /organize для таксономии задач (--no-organize для отключения) |'],
            '`--auto-start-screen-watch-message`': ['| `--show-limits` | | boolean | true | Экспериментально: разрешить вызывающим `/solve` и `/hive` использовать `--show-limits` (--no-show-limits для отключения) |'],
        },
        'replace': {
            '| Токен Telegram-бота от @BotFather ': '| Токен Telegram-бота от @BotFather; выводит предупреждение, лучше `.lenv` или `--configuration-file` ',
            '| Строка LINO; для секретов используйте `--configuration-file` ': '| Строка LINO; секреты в ней вызывают предупреждение, лучше `.lenv` или `--configuration-file` ',
            '| Путь к файлу LINO (права `0600` для секретов) ': '| Файл Links Notation по произвольному пути (права `0600` для секретов) ',
        },
    },
    'hi': {
        'intro': '''हर विकल्प को command-line argument या environment variable के रूप में सेट किया
जा सकता है ([Telegram Bot](#13-telegram-bot) देखें), इसलिए इसे `.lenv`, `.env`,
या `--configuration-file <path>` (या `HIVE_MIND_CONFIGURATION_FILE`) से चुनी गई
किसी custom path की Links Notation फ़ाइल में भी रखा जा सकता है। प्राथमिकता: स्पष्ट
CLI विकल्प, inline `--configuration`, configuration फ़ाइल, `TELEGRAM_CONFIGURATION`,
`.lenv`, फिर environment variables और `.env`। स्पष्ट रूप से दी गई पर न पढ़ी जा सकने
वाली configuration फ़ाइल startup को रोक देती है।

**अनुशंसित:** token और अन्य secrets को working directory की private `.lenv` फ़ाइल
(`chmod 600 .lenv`) में रखें और bot को सीधे `hive-telegram-bot` से शुरू करें। फ़ाइल
को कहीं और रखने के लिए `--configuration-file /path/to/bot.lenv` उपयोग करें।

Command line पर secrets (`--token`/`-t`, या token, key, secret, password या
credential entry वाला `--configuration`/`-c`) अब भी काम करते हैं, लेकिन host के सभी
users और processes उन्हें `ps` और `/proc/<pid>/cmdline` से पढ़ सकते हैं। Bot
`.lenv` या `--configuration-file` की सलाह के साथ warning दिखाता है और
`process.execve` वाले runtimes पर इन arguments के बिना उसी जगह खुद को फिर से launch
करता है (वही PID, runtime flags, standard streams, exit status और signals)। Re-launch
तक secrets दिखते हैं, इसलिए इस तरह दिया गया token @BotFather (`/revoke`) से बदलें।

''',
        'env': {
            '`TELEGRAM_ALLOWED_CHATS`': ['| `TELEGRAM_ALLOWED_TOPICS` | (सभी) | अनुमत `chatId topicId` pairs (Links Notation) |'],
            '`TELEGRAM_AUTH`': ['| `TELEGRAM_SHOW_LIMITS` | true | `/solve` और `/hive` callers को `--show-limits` उपयोग करने दें |',
                                '| `TELEGRAM_ISOLATION` | docker | Isolation backend (`screen`, `tmux`, `docker`); खाली मान isolation बंद करता है |'],
            '`TELEGRAM_BOT_VERBOSE`': ['| `TELEGRAM_DRY_RUN` | false | configuration validate करें और bot शुरू किए बिना exit करें |'],
        },
        'options': {
            '`--allowed-chats`': ['| `--allowed-topics` | | string | (सभी) | अनुमत `chatId topicId` pairs (Links Notation) |'],
            '`--task`': ['| `--fix` | | boolean | true | /fix command सक्षम करें (अक्षम करने के लिए --no-fix) |',
                         '| `--organize` | | boolean | true | /organize issue taxonomy command सक्षम करें (अक्षम करने के लिए --no-organize) |'],
            '`--auto-start-screen-watch-message`': ['| `--show-limits` | | boolean | true | Experimental: `/solve` और `/hive` callers को `--show-limits` उपयोग करने दें (अक्षम करने के लिए --no-show-limits) |'],
        },
        'replace': {
            '| @BotFather से Telegram bot token ': '| @BotFather से Telegram bot token; warning दिखाता है, `.lenv` या `--configuration-file` बेहतर है ',
            '| इनलाइन LINO कॉन्फ़िगरेशन; गोपनीय जानकारी के लिए `--configuration-file` उपयोग करें ': '| इनलाइन LINO कॉन्फ़िगरेशन; इसमें secrets warning दिखाते हैं, `.lenv` या `--configuration-file` बेहतर है ',
            '| LINO कॉन्फ़िगरेशन फ़ाइल का पथ (गोपनीय फ़ाइल के लिए `0600`) ': '| custom path की Links Notation कॉन्फ़िगरेशन फ़ाइल (गोपनीय फ़ाइल के लिए `0600`) ',
        },
    },
    'zh': {
        'intro': '''每个选项都可以通过命令行参数或环境变量设置（见 [Telegram Bot](#13-telegram-bot)），
因此也可以写入 `.lenv`、`.env`，或通过 `--configuration-file <path>`（或
`HIVE_MIND_CONFIGURATION_FILE`）指定的自定义路径 Links Notation 文件。优先级为：显式
CLI 选项、内联 `--configuration`、配置文件、`TELEGRAM_CONFIGURATION`、`.lenv`，然后是
环境变量和 `.env`。显式指定但无法读取的配置文件会导致启动失败。

**推荐：** 将 token 和其他机密保存在工作目录中的私有 `.lenv` 文件里（`chmod 600 .lenv`），
并直接使用 `hive-telegram-bot` 启动。若要把文件放在其他位置，请使用
`--configuration-file /path/to/bot.lenv`。

命令行中的机密（`--token`/`-t`，或包含 token、key、secret、password、credential 条目的
`--configuration`/`-c`）仍然可用，但主机上的所有用户和进程都可以通过 `ps` 和
`/proc/<pid>/cmdline` 读取。bot 会打印警告，建议使用 `.lenv` 或 `--configuration-file`，
并在支持 `process.execve` 的运行时中原地重新启动自身且不带这些参数（PID、运行时标志、
标准流、退出码和信号保持不变）。在重新启动之前机密仍然可见，因此请通过 @BotFather
（`/revoke`）轮换以这种方式传递过的 token。

''',
        'env': {
            '`TELEGRAM_ALLOWED_CHATS`': ['| `TELEGRAM_ALLOWED_TOPICS` | （全部） | 允许的 `chatId topicId` 对（Links Notation） |'],
            '`TELEGRAM_AUTH`': ['| `TELEGRAM_SHOW_LIMITS` | true | 允许 `/solve` 和 `/hive` 调用者使用 `--show-limits` |',
                                '| `TELEGRAM_ISOLATION` | docker | 隔离后端（`screen`、`tmux`、`docker`）；空值禁用隔离 |'],
            '`TELEGRAM_BOT_VERBOSE`': ['| `TELEGRAM_DRY_RUN` | false | 验证配置并在不启动 bot 的情况下退出 |'],
        },
        'options': {
            '`--allowed-chats`': ['| `--allowed-topics` | | string | （全部） | 允许的 `chatId topicId` 对（Links Notation） |'],
            '`--task`': ['| `--fix` | | boolean | true | 启用 /fix 命令（使用 --no-fix 禁用） |',
                         '| `--organize` | | boolean | true | 启用 /organize 问题分类命令（使用 --no-organize 禁用） |'],
            '`--auto-start-screen-watch-message`': ['| `--show-limits` | | boolean | true | 实验性：允许 `/solve` 和 `/hive` 调用者使用 `--show-limits`（使用 --no-show-limits 禁用） |'],
        },
        'replace': {
            '| 来自 @BotFather 的 Telegram bot token ': '| 来自 @BotFather 的 Telegram bot token；会打印警告，建议使用 `.lenv` 或 `--configuration-file` ',
            '| 内联 LINO 配置；机密请使用 `--configuration-file` ': '| 内联 LINO 配置；其中的机密会触发警告，建议使用 `.lenv` 或 `--configuration-file` ',
            '| LINO 配置文件路径（机密文件权限设为 `0600`） ': '| 自定义路径的 Links Notation 配置文件（机密文件权限设为 `0600`） ',
        },
    },
}

for lang, t in T.items():
    path = f'docs/CONFIGURATION.{lang}.md'
    lines = open(path, encoding='utf-8').read().split('\n')
    bot_usage = next(i for i, line in enumerate(lines) if line == 'hive-telegram-bot [options]')
    out = []
    for i, line in enumerate(lines):
        for old, new in t['replace'].items():
            if i > bot_usage and old in line:
                line = line.replace(old, new)
        out.append(line)
        cell = line.split('|')[1].strip() if line.startswith('| ') else None
        rows = (t['options'] if i > bot_usage else t['env']).get(cell)
        if rows and not any(r.split('|')[1].strip() in lines for r in rows):
            out.extend(rows)
    text = '\n'.join(out)
    # Insert the intro right before the usage code block of the bot section.
    marker = '```bash\nhive-telegram-bot [options]'
    assert text.count(marker) == 1, path
    text = text.replace(marker, t['intro'] + marker)
    for old in t['replace']:
        assert old not in text.split(marker)[1], (path, old)
    open(path, 'w', encoding='utf-8').write(text)
    print('updated', path)
