#!/usr/bin/env python3
"""Insert the issue #4069 docs (/after, /enqueue, --respect-blockers) into the READMEs and configuration docs."""
import pathlib
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')

README = {
    'README.md': ('> **📖 Free Models Guide**', """#### `/after` and `/enqueue` - Start a Task After Another Task

```
/after <task-link> [options]                     (reply to the awaited task's message)
/after <uuid|awaited-link> <task-link> [options]
/after [options]                                 (reply: run the same link again afterwards)
/enqueue ...                                     (same forms)
```

Both commands start exactly one task after another task has finished. The task
to wait for is found the way `/stop`, `/log` and `/watch` find a task: a session
UUID or an issue/pull request link, in the replied message or in the command.
Everything else works as in `/solve` (the link to start and its options).

- `/after` starts the task only when the awaited task **succeeds** (a run
  without changes counts as a success). When the awaited task fails, is
  cancelled or is killed, the waiting task fails too.
- `/enqueue` starts the task once the awaited task **finishes**, whatever the
  outcome.

A waiting task is listed in `/queue` under "Waiting for other tasks" and can be
stopped with `/stop` before it starts.

**`--respect-blockers` (experimental, off by default).** Add it to `/solve`,
`/claude`, `/codex` or any other solve command to respect the issue's GitHub
relations, as `/hive` does: open "blocked by" issues, open sub-issues (a
sub-issue blocks its parent) and the blockers of its ancestors. When every open
blocker is already queued or running, the task waits for them as with `/after`.
When a blocker is neither queued nor running, the task is not started.
`TELEGRAM_SOLVE_RESPECT_BLOCKERS=true` turns it on for every solve command. A
command with several links respects blockers by default and starts the
unblocked links first (`TELEGRAM_BATCH_RESPECT_BLOCKERS=false`, or
`--no-respect-blockers` for one command, turns that off).

"""),
    'README.ru.md': ('#### `/hive` — Запуск оркестрации Hive', """#### `/after` и `/enqueue` — запуск задачи после другой задачи

```
/after <ссылка-задачи> [опции]                       (ответ на сообщение ожидаемой задачи)
/after <uuid|ожидаемая-ссылка> <ссылка-задачи> [опции]
/after [опции]                                       (ответ: запустить ту же ссылку ещё раз после неё)
/enqueue ...                                         (те же формы)
```

Обе команды запускают ровно одну задачу после завершения другой. Ожидаемая
задача находится так же, как в `/stop`, `/log` и `/watch`: UUID сессии или
ссылка на задачу/pull request в сообщении, на которое дан ответ, или в самой
команде. Всё остальное работает как в `/solve` (ссылка для запуска и её опции).

- `/after` запускает задачу только при **успешном** завершении ожидаемой задачи
  (запуск без изменений считается успехом). Если ожидаемая задача завершилась
  ошибкой, отменена или остановлена, ожидающая задача тоже завершается ошибкой.
- `/enqueue` запускает задачу после **любого** завершения ожидаемой задачи.

Ожидающая задача показывается в `/queue` в разделе «Ждут другие задачи», и её
можно остановить командой `/stop` до запуска.

**`--respect-blockers` (экспериментально, по умолчанию выключено).** Добавьте к
`/solve`, `/claude`, `/codex` или другой команде solve, чтобы учитывать связи
задачи в GitHub, как это делает `/hive`: открытые блокирующие задачи («blocked
by»), открытые подзадачи (подзадача блокирует родителя) и блокеры предков. Если
все открытые блокеры уже в очереди или выполняются, задача ждёт их, как с
`/after`. Если блокер не в очереди и не выполняется, задача не запускается.
`TELEGRAM_SOLVE_RESPECT_BLOCKERS=true` включает это для всех команд solve.
Команда с несколькими ссылками учитывает блокеры по умолчанию и сначала
запускает незаблокированные ссылки (`TELEGRAM_BATCH_RESPECT_BLOCKERS=false` или
`--no-respect-blockers` для одной команды отключают это).

"""),
    'README.zh.md': ('#### `/hive` - 运行蜂群编排', """#### `/after` 和 `/enqueue` - 在另一个任务之后启动任务

```
/after <任务链接> [选项]                        （回复被等待任务的消息）
/after <uuid|被等待的链接> <任务链接> [选项]
/after [选项]                                   （回复：之后再次运行同一链接）
/enqueue ...                                    （同样的形式）
```

两个命令都会在另一个任务结束后启动恰好一个任务。被等待的任务的查找方式与
`/stop`、`/log` 和 `/watch` 相同：会话 UUID 或 issue/pull request 链接，位于被回复的消息或命令本身中。
其余部分与 `/solve` 相同（要启动的链接及其选项）。

- `/after` 仅在被等待的任务**成功**时启动任务（没有更改的运行也算成功）。
  如果被等待的任务失败、被取消或被终止，等待中的任务也会失败。
- `/enqueue` 在被等待的任务**结束**后启动任务，无论结果如何。

等待中的任务会在 `/queue` 的“等待其他任务”部分列出，并可在启动前用 `/stop` 停止。

**`--respect-blockers`（实验性，默认关闭）。** 将其添加到 `/solve`、`/claude`、`/codex`
或其他 solve 命令，即可像 `/hive` 一样遵守 issue 的 GitHub 关系：未关闭的“blocked by”
issue、未关闭的子 issue（子 issue 阻塞其父 issue）以及祖先的阻塞项。如果所有未关闭的阻塞项
都已排队或正在运行，任务会像 `/after` 一样等待它们。如果某个阻塞项既未排队也未运行，任务不会启动。
`TELEGRAM_SOLVE_RESPECT_BLOCKERS=true` 会为所有 solve 命令启用此功能。包含多个链接的命令默认遵守阻塞项，
并先启动未被阻塞的链接（`TELEGRAM_BATCH_RESPECT_BLOCKERS=false`，或单个命令使用
`--no-respect-blockers` 可关闭此行为）。

"""),
    'README.hi.md': ('#### `/hive` - Hive ऑर्केस्ट्रेशन चलाएँ', """#### `/after` और `/enqueue` - किसी दूसरे कार्य के बाद कार्य शुरू करें

```
/after <task-link> [options]                     (प्रतीक्षित कार्य के संदेश का उत्तर दें)
/after <uuid|awaited-link> <task-link> [options]
/after [options]                                 (उत्तर: बाद में वही link फिर से चलाएँ)
/enqueue ...                                     (वही रूप)
```

दोनों commands किसी दूसरे कार्य के समाप्त होने के बाद ठीक एक कार्य शुरू करते हैं।
प्रतीक्षित कार्य वैसे ही खोजा जाता है जैसे `/stop`, `/log` और `/watch` खोजते हैं:
session UUID या issue/pull request link, उत्तर दिए गए संदेश में या command में।
बाकी सब `/solve` की तरह काम करता है (शुरू करने वाला link और उसके options)।

- `/after` कार्य तभी शुरू करता है जब प्रतीक्षित कार्य **सफल** हो (बिना बदलाव वाला
  run भी सफल माना जाता है)। यदि प्रतीक्षित कार्य विफल, रद्द या बंद हो जाता है, तो
  प्रतीक्षा करने वाला कार्य भी विफल हो जाता है।
- `/enqueue` प्रतीक्षित कार्य के **समाप्त** होने के बाद कार्य शुरू करता है, परिणाम चाहे जो हो।

प्रतीक्षा करने वाला कार्य `/queue` में "अन्य कार्यों की प्रतीक्षा में" के अंतर्गत दिखता है
और शुरू होने से पहले `/stop` से रोका जा सकता है।

**`--respect-blockers` (प्रायोगिक, डिफ़ॉल्ट रूप से बंद)।** इसे `/solve`, `/claude`,
`/codex` या किसी अन्य solve command में जोड़ें, ताकि issue के GitHub संबंधों का
सम्मान हो, जैसा `/hive` करता है: खुले "blocked by" issues, खुले sub-issues (sub-issue
अपने parent को block करता है) और पूर्वजों के blockers। यदि सभी खुले blockers पहले से
queue में हैं या चल रहे हैं, तो कार्य `/after` की तरह उनकी प्रतीक्षा करता है। यदि कोई
blocker न queue में है न चल रहा है, तो कार्य शुरू नहीं होता।
`TELEGRAM_SOLVE_RESPECT_BLOCKERS=true` इसे हर solve command के लिए चालू करता है। कई
links वाला command डिफ़ॉल्ट रूप से blockers का सम्मान करता है और पहले unblocked links
शुरू करता है (`TELEGRAM_BATCH_RESPECT_BLOCKERS=false`, या एक command के लिए
`--no-respect-blockers`, इसे बंद करता है)।

"""),
}

ENV_ROWS = {
    'docs/CONFIGURATION.md': ('| `TELEGRAM_SOLVE_RESPECT_BLOCKERS` | false | Experimental: solve commands respect GitHub blockers and open sub-issues, as with `--respect-blockers` |',
                              '| `TELEGRAM_BATCH_RESPECT_BLOCKERS` | true | A solve command with several links starts unblocked issues first and queues the others after their blockers |'),
    'docs/CONFIGURATION.ru.md': ('| `TELEGRAM_SOLVE_RESPECT_BLOCKERS` | false | Экспериментально: команды solve учитывают блокеры и открытые подзадачи GitHub, как с `--respect-blockers` |',
                                 '| `TELEGRAM_BATCH_RESPECT_BLOCKERS` | true | Команда solve с несколькими ссылками сначала запускает незаблокированные задачи, остальные — после их блокеров |'),
    'docs/CONFIGURATION.zh.md': ('| `TELEGRAM_SOLVE_RESPECT_BLOCKERS` | false | 实验性：solve 命令遵守 GitHub 阻塞项和未关闭的子 issue，等同于 `--respect-blockers` |',
                                 '| `TELEGRAM_BATCH_RESPECT_BLOCKERS` | true | 包含多个链接的 solve 命令先启动未被阻塞的 issue，其余的在其阻塞项之后排队 |'),
    'docs/CONFIGURATION.hi.md': ('| `TELEGRAM_SOLVE_RESPECT_BLOCKERS` | false | प्रायोगिक: solve commands GitHub blockers और खुले sub-issues का सम्मान करते हैं, `--respect-blockers` की तरह |',
                                 '| `TELEGRAM_BATCH_RESPECT_BLOCKERS` | true | कई links वाला solve command पहले unblocked issues शुरू करता है और बाकी को उनके blockers के बाद queue करता है |'),
}

CLI_ROWS = ('| `--solve-respect-blockers` |  | boolean | false | Experimental: solve commands respect GitHub blockers and open sub-issues by default, as with `--respect-blockers` (issue #4069). |',
            '| `--batch-respect-blockers` |  | boolean | true | A solve command with several links starts unblocked issues first and queues the others after their blockers (`--no-batch-respect-blockers` to disable). |')

ENV_EXAMPLE = """
# Optional: GitHub blockers and sub-issues before a solve task starts (issue #4069)
# Experimental: every solve command behaves as if it had --respect-blockers.
# TELEGRAM_SOLVE_RESPECT_BLOCKERS=false
# A solve command with several links starts unblocked issues first (default true).
# TELEGRAM_BATCH_RESPECT_BLOCKERS=true
"""


def insert_before(path, anchor, text):
    file = ROOT / path
    content = file.read_text(encoding='utf-8')
    if 'TELEGRAM_SOLVE_RESPECT_BLOCKERS' in content and path.startswith('README'):
        return
    index = content.index(anchor)
    file.write_text(content[:index] + text + content[index:], encoding='utf-8')


def insert_after_line(path, needle, rows):
    file = ROOT / path
    lines = file.read_text(encoding='utf-8').split('\n')
    if any(rows[0].split('|')[1].strip() in line for line in lines):
        return
    index = next(i for i, line in enumerate(lines) if needle in line)
    lines[index + 1:index + 1] = list(rows)
    file.write_text('\n'.join(lines), encoding='utf-8')


for path, (anchor, text) in README.items():
    insert_before(path, anchor, text)
for path, rows in ENV_ROWS.items():
    insert_after_line(path, '`TELEGRAM_AUTO_START_SCREEN_WATCH_MESSAGE`', rows)
    if '`--auto-start-screen-watch-message`' in (ROOT / path).read_text(encoding='utf-8'):
        insert_after_line(path, '`--auto-start-screen-watch-message`', CLI_ROWS)
env = ROOT / '.env.example'
content = env.read_text(encoding='utf-8')
if 'TELEGRAM_SOLVE_RESPECT_BLOCKERS' not in content:
    anchor = '# TELEGRAM_AUTO_START_SCREEN_WATCH_MESSAGE=false\n'
    env.write_text(content.replace(anchor, anchor + ENV_EXAMPLE, 1), encoding='utf-8')
print('ok')
