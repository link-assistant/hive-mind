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

> **Примечание:** С задачи #1639 скрипт `ubuntu-24-server-install.sh` был удалён из репозитория.
> Docker-образ теперь использует `ghcr.io/link-foundation/box` (зафиксированный на конкретной версии) в качестве базового образа, который предоставляет все инструменты разработки.
> Для исторической справки последняя версия скрипта, которая устанавливала весь стек Hive Mind поверх Ubuntu 24.04, сохранена по адресу:
> https://github.com/link-assistant/hive-mind/blob/4f027b32/scripts/ubuntu-24-server-install.sh
>
> Образ `ghcr.io/link-foundation/box` является универсальным базовым образом и сам по себе не содержит инструменты Hive Mind, поэтому этот устаревший скрипт Hive Mind оставлен как единственный оставшийся источник для варианта установки на «голое железо».

## Шаги

1. Сбросьте/установите VPS/VDS сервер со свежим Ubuntu 24.04
2. Войдите как пользователь `root`.
3. Запустите архивный установщик Hive Mind для Ubuntu

   ```bash
   curl -fsSL -o- https://raw.githubusercontent.com/link-assistant/hive-mind/4f027b32/scripts/ubuntu-24-server-install.sh | bash
   ```

   **Примечание:** Установка НЕ запускает `gh auth login` автоматически. Это намеренно для поддержки сборок Docker без таймаутов. Аутентификация выполняется на следующих шагах.

4. Войдите как пользователь `box`

   ```bash
   su - box
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

   Примечание: Как opencode, так и agent по умолчанию используют бесплатную модель (Big Pickle для opencode, Nemotron 3 Super для agent) — поэтому авторизация для этих инструментов не требуется.

7. Запустите Telegram-бот Hive Mind:

   **Используя Links Notation (рекомендуется):**

   ```
   screen -R bot # Enter new screen for bot

   umask 077
   cat > bot.lenv <<'LENV'
     TELEGRAM_BOT_TOKEN: YOUR_TELEGRAM_BOT_TOKEN
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
   LENV
   chmod 600 bot.lenv
   hive-telegram-bot --configuration-file bot.lenv

   # Press CTRL + A + D for detach from screen
   ```

   **Используя отдельные параметры командной строки:**

   ```
   screen -R bot # Enter new screen for bot

   read -rsp "Токен Telegram-бота: " TELEGRAM_BOT_TOKEN
   echo
   export TELEGRAM_BOT_TOKEN
   hive-telegram-bot --allowed-chats "(
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

Выполните команды ниже на машине, где будет работать Codex. С другой машины выполните `hive-manager --host deploy@your-server auth codex`. Откройте показанную страницу авторизации устройства и введите код в браузере. Затем проверьте состояние входа.

```bash
hive-manager auth codex
hive-manager auth codex status
```

Без менеджера используйте `codex login --device-auth` и `codex login status` напрямую. См. [руководство по входу в Codex](deployment/hive-manager.md#headless-sign-in).
