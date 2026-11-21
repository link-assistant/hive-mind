"""Insert the issue #4069 locale strings (/after, /enqueue, --respect-blockers) into locales/*.lino."""
import sys

T = {
 'en': dict(
  queued="⏳ Solve command queued after other tasks",
  success="Starts when {{tasks}} finishes successfully; it is not started if that task fails.",
  finish="Starts when {{tasks}} finishes, whatever the result.",
  blockers_wait="Waits for its GitHub blockers {{tasks}}: {{description}}",
  released="▶️ The awaited tasks are done ({{tasks}}); the task is queued.",
  dep_failed="an awaited task did not succeed: {{task}}",
  not_queued="it is blocked by {{blockers}}, which is neither queued nor running ({{description}}). Queue the blockers first, or send the command without `--respect-blockers`.",
  usage=["❌ Tell me which task to wait for.", "", "Reply to the task's message: `/after <github-url>`", "Or name the task: `/after <uuid|github-url> <github-url> [options]`", "", "`/after` starts the new task only if the awaited one succeeds; `/enqueue` starts it whatever the result. Without a new link, the awaited link runs again."],
  many="❌ /after and /enqueue start one task after one other task. Too many tasks: {{links}}",
  invalid="❌ Not an issue or pull request link: {{links}}",
  unknown="❌ No queued or running task found for {{task}}. Reply to the task's message, or name its session UUID or link.",
  no_link="❌ The task {{task}} has no link to start again. Add the issue or pull request link to start after it.",
  t_failed="❌ Not started: {{task}} already {{detail}}, and /after starts a task only after a successful one. Use /enqueue to start it anyway.",
  t_finished="ℹ️ {{task}} already {{detail}}; starting now.",
  help_after="*/after* `<task> <github-url>` - Start a task after another one succeeds; if that one fails, this one is not started. */enqueue* does the same whatever the result. The awaited task is a session UUID or link, or the replied message; without a new link its link runs again.",
  help_blockers="`--respect-blockers` (experimental) - Wait for the issue's GitHub blockers and open sub-issues when they are queued; refuse to start while one is neither queued nor running. A list of links does this by default (`--no-respect-blockers` turns it off).",
 ),
 'ru': dict(
  queued="⏳ Команда solve поставлена в очередь после других задач",
  success="Начнётся, когда {{tasks}} успешно завершится; если эта задача не удастся, не начнётся.",
  finish="Начнётся, когда {{tasks}} завершится, с любым результатом.",
  blockers_wait="Ждёт свои блокирующие задачи GitHub {{tasks}}: {{description}}",
  released="▶️ Ожидаемые задачи завершены ({{tasks}}); задача поставлена в очередь.",
  dep_failed="ожидаемая задача не удалась: {{task}}",
  not_queued="её блокирует {{blockers}}, и эта задача не в очереди и не запущена ({{description}}). Сначала поставьте блокирующие задачи в очередь или отправьте команду без `--respect-blockers`.",
  usage=["❌ Укажите, какую задачу ждать.", "", "Ответьте на сообщение задачи: `/after <github-url>`", "Или назовите задачу: `/after <uuid|github-url> <github-url> [опции]`", "", "`/after` запускает новую задачу, только если ожидаемая завершилась успешно; `/enqueue` — с любым результатом. Без новой ссылки ожидаемая ссылка запускается снова."],
  many="❌ /after и /enqueue запускают одну задачу после одной другой. Слишком много задач: {{links}}",
  invalid="❌ Это не ссылка на issue или pull request: {{links}}",
  unknown="❌ Не найдена задача в очереди или запущенная задача для {{task}}. Ответьте на сообщение задачи или укажите её UUID сессии или ссылку.",
  no_link="❌ У задачи {{task}} нет ссылки для повторного запуска. Добавьте ссылку на issue или pull request, который нужно запустить после неё.",
  t_failed="❌ Не запущено: {{task}} — {{detail}}, а /after запускает задачу только после успешной. Чтобы запустить всё равно, используйте /enqueue.",
  t_finished="ℹ️ {{task}} — {{detail}}; запускаю сейчас.",
  help_after="*/after* `<задача> <github-url>` - Запустить задачу после успешного завершения другой; если та не удастся, эта не запустится. */enqueue* делает то же при любом результате. Ожидаемая задача — UUID сессии или ссылка, или сообщение, на которое вы отвечаете; без новой ссылки её ссылка запускается снова.",
  help_blockers="`--respect-blockers` (экспериментально) - Ждать блокирующие задачи GitHub и открытые подзадачи issue, если они в очереди; не запускать, пока одна из них не в очереди и не запущена. Список ссылок делает так по умолчанию (`--no-respect-blockers` отключает).",
 ),
 'zh': dict(
  queued="⏳ solve 命令已排在其他任务之后",
  success="{{tasks}} 成功完成后开始；如果该任务失败，则不会开始。",
  finish="{{tasks}} 完成后开始，无论结果如何。",
  blockers_wait="等待其 GitHub 阻塞项 {{tasks}}：{{description}}",
  released="▶️ 等待的任务已完成（{{tasks}}）；任务已入队。",
  dep_failed="等待的任务未成功：{{task}}",
  not_queued="它被 {{blockers}} 阻塞，而该任务既未入队也未运行（{{description}}）。请先将阻塞任务入队，或不带 `--respect-blockers` 发送命令。",
  usage=["❌ 请指明要等待的任务。", "", "回复该任务的消息：`/after <github-url>`", "或指明任务：`/after <uuid|github-url> <github-url> [选项]`", "", "`/after` 仅在等待的任务成功后启动新任务；`/enqueue` 无论结果如何都会启动。未提供新链接时，将再次运行等待任务的链接。"],
  many="❌ /after 和 /enqueue 在一个任务之后启动一个任务。任务过多：{{links}}",
  invalid="❌ 不是 issue 或 pull request 链接：{{links}}",
  unknown="❌ 未找到 {{task}} 对应的排队中或运行中的任务。请回复该任务的消息，或指明其会话 UUID 或链接。",
  no_link="❌ 任务 {{task}} 没有可再次启动的链接。请添加要在其后启动的 issue 或 pull request 链接。",
  t_failed="❌ 未启动：{{task}} 已经 {{detail}}，而 /after 只在任务成功后启动。如仍要启动，请使用 /enqueue。",
  t_finished="ℹ️ {{task}} 已经 {{detail}}；现在启动。",
  help_after="*/after* `<任务> <github-url>` - 在另一个任务成功后启动任务；如果该任务失败，则不启动。*/enqueue* 无论结果如何都会启动。等待的任务可以是会话 UUID、链接或被回复的消息；未提供新链接时，将再次运行其链接。",
  help_blockers="`--respect-blockers`（实验性）- 当 issue 的 GitHub 阻塞项和未关闭的子 issue 已入队时等待它们；若有一项既未入队也未运行，则拒绝启动。多个链接默认如此（`--no-respect-blockers` 可关闭）。",
 ),
 'hi': dict(
  queued="⏳ solve command अन्य कार्यों के बाद queue में जोड़ी गई",
  success="{{tasks}} सफलतापूर्वक पूरा होने पर शुरू होगा; वह कार्य विफल होने पर शुरू नहीं होगा।",
  finish="{{tasks}} पूरा होने पर शुरू होगा, परिणाम चाहे जो हो।",
  blockers_wait="अपने GitHub blockers {{tasks}} की प्रतीक्षा करता है: {{description}}",
  released="▶️ प्रतीक्षित कार्य पूरे हुए ({{tasks}}); कार्य queue में जोड़ा गया।",
  dep_failed="एक प्रतीक्षित कार्य सफल नहीं हुआ: {{task}}",
  not_queued="इसे {{blockers}} block करता है, जो न queue में है न चल रहा है ({{description}})। पहले blockers को queue करें, या command को `--respect-blockers` के बिना भेजें।",
  usage=["❌ बताएं कि किस कार्य की प्रतीक्षा करनी है।", "", "कार्य के संदेश का उत्तर दें: `/after <github-url>`", "या कार्य बताएं: `/after <uuid|github-url> <github-url> [options]`", "", "`/after` नया कार्य केवल तभी शुरू करता है जब प्रतीक्षित कार्य सफल हो; `/enqueue` परिणाम चाहे जो हो शुरू करता है। नया लिंक न होने पर प्रतीक्षित लिंक फिर से चलता है।"],
  many="❌ /after और /enqueue एक कार्य के बाद एक कार्य शुरू करते हैं। बहुत अधिक कार्य: {{links}}",
  invalid="❌ यह issue या pull request लिंक नहीं है: {{links}}",
  unknown="❌ {{task}} के लिए कोई queued या चल रहा कार्य नहीं मिला। कार्य के संदेश का उत्तर दें, या उसका session UUID या लिंक बताएं।",
  no_link="❌ कार्य {{task}} का फिर से शुरू करने के लिए कोई लिंक नहीं है। इसके बाद शुरू करने के लिए issue या pull request लिंक जोड़ें।",
  t_failed="❌ शुरू नहीं हुआ: {{task}} पहले ही {{detail}}, और /after केवल सफल कार्य के बाद शुरू करता है। फिर भी शुरू करने के लिए /enqueue का उपयोग करें।",
  t_finished="ℹ️ {{task}} पहले ही {{detail}}; अभी शुरू कर रहे हैं।",
  help_after="*/after* `<task> <github-url>` - किसी अन्य कार्य के सफल होने के बाद कार्य शुरू करें; वह विफल हो तो यह शुरू नहीं होगा। */enqueue* परिणाम चाहे जो हो यही करता है। प्रतीक्षित कार्य session UUID, लिंक या उत्तर दिया गया संदेश है; नया लिंक न होने पर उसका लिंक फिर से चलता है।",
  help_blockers="`--respect-blockers` (प्रयोगात्मक) - issue के GitHub blockers और खुले sub-issues queue में हों तो उनकी प्रतीक्षा करें; कोई न queue में हो न चल रहा हो तो शुरू न करें। लिंक की सूची में यह default है (`--no-respect-blockers` इसे बंद करता है)।",
 ),
}

def q(s):
    assert '"' not in s
    return f'"{s}"'

def block(d):
    i = ' ' * 6
    lines = [
      f'{i}after',
      f'{i}  queued {q(d["queued"])}',
      f'{i}  waiting',
      f'{i}    success {q(d["success"])}',
      f'{i}    finish {q(d["finish"])}',
      f'{i}    blockers {q(d["blockers_wait"])}',
      f'{i}  released {q(d["released"])}',
      f'{i}  dependency',
      f'{i}    failed {q(d["dep_failed"])}',
      f'{i}  blockers',
      f'{i}    not',
      f'{i}      queued {q(d["not_queued"])}',
      f'{i}  usage """',
      *[(f'{i}    {l}' if l else '') for l in d['usage']],
      f'{i}  """',
      f'{i}  many',
      f'{i}    tasks {q(d["many"])}',
      f'{i}  invalid',
      f'{i}    link {q(d["invalid"])}',
      f'{i}  unknown',
      f'{i}    target {q(d["unknown"])}',
      f'{i}  no',
      f'{i}    task',
      f'{i}      link {q(d["no_link"])}',
      f'{i}  target',
      f'{i}    failed {q(d["t_failed"])}',
      f'{i}    finished {q(d["t_finished"])}',
    ]
    return lines

for loc, d in T.items():
    path = f'locales/{loc}.lino'
    lines = open(path, encoding='utf-8').read().split('\n')
    assert lines[596].startswith('        reply "'), (loc, lines[596])
    assert lines[430].startswith('      waiting "'), (loc, lines[430])
    assert '/qwen' in lines[647] and '/task' in lines[647], loc
    sep = '、' if loc == 'zh' else ', '
    lines[647] = lines[647].replace(f'/qwen{sep}/task', f'/qwen{sep}/after{sep}/enqueue{sep}/task')
    assert '/after' in lines[647], loc
    help_lines = [f'        after {q(d["help_after"])}', '        respect', f'          blockers {q(d["help_blockers"])}']
    lines[597:597] = help_lines
    lines[431:431] = block(d)
    open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print(loc, 'ok')
