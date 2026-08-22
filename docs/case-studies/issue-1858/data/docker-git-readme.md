# docker-git

`docker-git` создаёт отдельную Docker-среду для каждого репозитория, issue или PR.
По умолчанию проекты лежат в `~/.docker-git`.

License: MIT. See [LICENSE](LICENSE).

## Установка

```bash
git clone https://github.com/proverCoderAI/docker-git
cd docker-git
```

Локальный запуск из репозитория:

```bash
bun install
bun run docker-git --help
```

## Авторизация

```bash
bun run docker-git auth github login --web
bun run docker-git auth codex login --web
bun run docker-git auth claude login --web
bun run docker-git auth grok login --web
```

Для запуска WEB версии:

```bash
bun run docker-git -- browser
```

По умолчанию web-версия слушает все интерфейсы хоста (`0.0.0.0`), поэтому её можно открыть с другого устройства в LAN, например `http://192.168.0.206:4174/`. Чтобы ограничить доступ только этой машиной:

```bash
DOCKER_GIT_WEB_HOST=127.0.0.1 bun run docker-git -- browser
```

## CLI пример

Можно передавать ссылку на репозиторий, ветку (`/tree/...`), issue или PR.

```bash
bun run  docker-git clone https://github.com/ProverCoderAI/docker-git/issues/122 --force --mcp-playwright
```

- `--force` пересоздаёт окружение и удаляет volumes проекта.
- `--mcp-playwright` включает Playwright MCP и Chromium sidecar для браузерной автоматизации.

Автоматический запуск агента:

```bash
bun run docker-git clone https://github.com/ProverCoderAI/docker-git/issues/122 --force --auto
```

- `--auto` сам выбирает Claude, Codex, Gemini или Grok по доступной авторизации. Если доступно несколько, выбор случайный.
- `--auto=claude`, `--auto=codex`, `--auto=gemini` или `--auto=grok` принудительно выбирает агента.
- В auto-режиме агент сам выполняет задачу, создаёт PR и после завершения контейнер очищается.

Применение конфигурации:

```bash
bun run docker-git apply
bun run docker-git apply --no-up
bun run docker-git apply-all
bun run docker-git apply-all --active
```

- `apply` применяет конфиг к одному проекту. `--no-up` только обновляет файлы без `docker compose up`.
- `apply-all` применяет конфиг ко всем проектам. `--active` только к запущенным контейнерам.

## Подробности

```bash
docker-git --help
```

Структура проекта:
APP - CLI + React (Frontend)
LIB - Весь бекенд (Основная бизнес логика)
API - Просто апи сервер поднятный над LIB

APP работает только с API, и не имеет доступа к LIB
API работает только с LIB
