# Установка на Ubuntu 24.04 Server (устарело) (languages: [en](UBUNTU-SERVER.md) • [zh](UBUNTU-SERVER.zh.md) • [hi](UBUNTU-SERVER.hi.md) • ru)

> ⚠️ **УСТАРЕЛО:** Этот метод установки больше не рекомендуется.
>
> **Теперь мы рекомендуем использовать Docker для всех установок**, как на машинах разработчиков, так и на серверах.
> Docker обеспечивает лучшую изоляцию, более простое управление и согласованные среды.
>
> Пожалуйста, используйте [метод установки через Docker](../README.ru.md#using-docker).
> Для развёртывания на Kubernetes смотрите [установку через Helm](../README.ru.md#helm-installation-kubernetes).
> Для подробного использования Docker смотрите [docs/DOCKER.ru.md](./DOCKER.ru.md).

---

Следующие инструкции описывают устаревшую установку на «голое железо» на Ubuntu 24.04 server. Этот подход сохранён только для справки.

> **Примечание:** С задачи #1394 скрипт `ubuntu-24-server-install.sh` был удалён из репозитория.
> Docker-образ теперь использует `konard/sandbox` (зафиксированный на конкретной версии) в качестве базового образа, который предоставляет все инструменты разработки.
> Для исторической справки последняя версия скрипта доступна по адресу:
> https://github.com/link-assistant/hive-mind/blob/4f027b32/scripts/ubuntu-24-server-install.sh

## Шаги

1. Сбросьте/установите VPS/VDS сервер со свежим Ubuntu 24.04
2. Войдите как пользователь `root`.
3. Сначала установите sandbox (предоставляет все инструменты разработки)

   ```bash
   # Option 1: Use Docker (recommended)
   docker pull konard/sandbox:1.6.0
   docker run -it konard/sandbox:1.6.0

   # Option 2: Use the sandbox install script (pinned to v1.3.16 release commit)
   curl -fsSL -o- https://github.com/link-foundation/sandbox/raw/178aa3816ab2c2150844fb967ffa329c63b90131/ubuntu/24.04/full-sandbox/install.sh | bash
   ```

   **Примечание:** Установка НЕ запускает `gh auth login` автоматически. Это намеренно для поддержки сборок Docker без таймаутов. Аутентификация выполняется на следующих шагах.

4. Войдите как пользователь `sandbox`

   ```bash
   su - sandbox
   ```

5. **ВАЖНО:** Пройдите аутентификацию в GitHub CLI ПОСЛЕ завершения установки

   ```bash
   gh-setup-git-identity
   ```

   Примечание: Следуйте подсказкам для аутентификации с вашим аккаунтом GitHub. Это необходимо для работы инструмента gh, и система будет выполнять все действия используя этот аккаунт GitHub. Этот шаг должен быть выполнен ПОСЛЕ завершения скрипта установки для избежания таймаутов сборки в Docker-средах.

6. Claude Code CLI, OpenCode AI CLI и @link-assistant/agent предустановлены с предыдущим скриптом. Теперь необходимо убедиться, что claude авторизован. Выполните команду claude и следуйте всем шагам для авторизации локального claude

   ```bash
   claude
   ```

   Примечание: Как opencode, так и agent поставляются с бесплатной моделью Grok Code Fast 1 по умолчанию — поэтому авторизация для этих инструментов не требуется.

7. Запустите Telegram-бот Hive Mind:

   **Используя Links Notation (рекомендуется):**

   ```
   screen -R bot # Enter new screen for bot

   hive-telegram-bot --configuration "
     TELEGRAM_BOT_TOKEN: '849...355:AAG...rgk_YZk...aPU'
     TELEGRAM_ALLOWED_CHATS:
       -1002975819706
       -1002861722681
     TELEGRAM_HIVE_OVERRIDES:
       --all-issues
       --once
       --skip-issues-with-prs
       --attach-logs
       --verbose
       --no-tool-check
     TELEGRAM_SOLVE_OVERRIDES:
       --attach-logs
       --verbose
       --no-tool-check
     TELEGRAM_BOT_VERBOSE: true
   "

   # Press CTRL + A + D for detach from screen
   ```

   **Используя отдельные параметры командной строки:**

   ```
   screen -R bot # Enter new screen for bot

   hive-telegram-bot --token 849...355:AAG...rgk_YZk...aPU --allowed-chats "(
     -1002975819706
     -1002861722681
   )" --hive-overrides "(
     --all-issues
     --once
     --skip-issues-with-prs
     --attach-logs
     --verbose
     --no-tool-check
   )" --solve-overrides "(
     --attach-logs
     --verbose
     --no-tool-check
   )" --verbose

   # Press CTRL + A + D for detach from screen
   ```

   Примечание: Возможно, вам потребуется зарегистрировать собственного бота на https://t.me/BotFather для получения токена бота.

## Вход в Codex

1. Подключитесь к вашему экземпляру VPS с установленным Hive Mind, используя SSH с открытым туннелем

```bash
ssh -L 1455:localhost:1455 root@123.123.123.123
```

2. Запустите oAuth-сервер для входа в codex:

```bash
codex login
```

Будет запущен oAuth callback-сервер на порту 1455, и будет напечатана ссылка на oAuth, скопируйте ссылку.

3. Используйте браузер на машине, с которой вы открыли туннель, вставьте туда ссылку из команды `codex login` и перейдите туда через браузер. После перенаправления на localhost:1455 вы увидите страницу успешного входа, а в `codex login` увидите `Successfully logged in`. После этого команда `codex login` завершится, и вы сможете использовать команду `codex` как обычно для проверки. Она также должна работать с `--tool codex` в командах `solve` и `hive`.
