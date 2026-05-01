# Поддержка Docker для Hive Mind (languages: [en](DOCKER.md) • [zh](DOCKER.zh.md) • [hi](DOCKER.hi.md) • ru)

Этот документ объясняет, как запускать Hive Mind в Docker-контейнерах.

## Быстрый старт

### Вариант 1: Использование готового образа из Docker Hub (рекомендуется)

```bash
# Pull the latest image
docker pull konard/hive-mind:latest

# Run an interactive session
docker run -it konard/hive-mind:latest

# IMPORTANT: Authentication is done AFTER the Docker image is installed
# The installation script does NOT run gh auth login to avoid build timeouts
# This allows the Docker build to complete successfully without interactive prompts

# Inside the container, authenticate with GitHub
gh auth login -h github.com -s repo,workflow,user,read:org,gist

# Authenticate with Claude
claude

# Now you can use hive and solve commands
solve https://github.com/owner/repo/issues/123
```

### Вариант 2: Локальная сборка

```bash
# Build the production image
docker build -t hive-mind:local .

# Run the image
docker run -it hive-mind:local
```

### Вариант 3: Docker-in-Docker образ

Используйте `konard/hive-mind-dind:latest`, когда агенту нужно запускать Docker, Docker Compose или Testcontainers внутри контейнера Hive Mind.

```bash
# Pull the Docker-in-Docker image
docker pull konard/hive-mind-dind:latest

# Default runtime: privileged container starts an inner dockerd
docker run --rm --privileged -it konard/hive-mind-dind:latest bash

# Inside the container, verify nested Docker
docker info
docker run hello-world
```

На общих хостах лучше использовать Sysbox runtime, если он доступен:

```bash
docker run --rm --runtime=sysbox-runc -it konard/hive-mind-dind:latest bash
```

DinD-образ публикуется отдельно от `konard/hive-mind:latest`, поэтому пользователи без необходимости во вложенном Docker могут продолжать использовать существующий образ с меньшими привилегиями.

### Вариант 4: Режим разработки (в стиле Gitpod)

Для целей разработки устаревший `Dockerfile` предоставляет Gitpod-совместимую среду:

```bash
# Build the development image
docker build -t hive-mind-dev .

# Run with credential mounts
docker run --rm -it \
    -v ~/.config/gh:/home/box/.persisted-configs/gh:ro \
    -v ~/.local/share/claude-profiles:/home/box/.persisted-configs/claude:ro \
    -v ~/.config/claude-code:/home/box/.persisted-configs/claude-code:ro \
    -v "$(pwd)/output:/home/box/output" \
    hive-mind-dev
```

## Аутентификация

Production Docker-образ (`Dockerfile`) использует Ubuntu 24.04 и официальный скрипт установки. **ВАЖНО:** Аутентификация выполняется **внутри контейнера ПОСЛЕ** того, как Docker-образ полностью установлен и запущен.

**Почему аутентификация происходит после установки:**

- ✅ Избегает таймаутов сборки Docker, вызванных интерактивными подсказками
- ✅ Предотвращает сбои сборки в CI/CD-пайплайнах
- ✅ Позволяет скрипту установки успешно завершиться
- ✅ Поддерживает автоматизированные сборки Docker-образов

### Аутентификация GitHub

```bash
# Inside the container, AFTER it's running
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

**Примечание:** Скрипт установки намеренно НЕ вызывает `gh auth login` в процессе сборки. Это сделано специально для поддержки сборок Docker без таймаутов.

### Аутентификация Claude

```bash
# Inside the container, AFTER it's running
claude
```

Этот подход позволяет:

- ✅ Нескольким Docker-экземплярам использовать разные аккаунты GitHub
- ✅ Нескольким Docker-экземплярам использовать разные подписки Claude
- ✅ Никакой утечки учётных данных между контейнерами
- ✅ Каждый контейнер имеет собственную изолированную аутентификацию
- ✅ Успешные сборки Docker без интерактивной аутентификации

## Предварительные требования

1. **Docker:** Установите Docker Desktop или Docker Engine (версия 20.10 или выше)
2. **Интернет-соединение:** Требуется для загрузки образов и аутентификации

## Структура директорий

```
.
├── Dockerfile                    # Production image using Ubuntu 24.04
├── experiments/
│   └── solve-dockerize/
│       └── Dockerfile            # Legacy Gitpod-compatible image (archived)
├── scripts/
│   └── ubuntu-24-server-install.sh  # Installation script used by Dockerfile
└── docs/
    └── DOCKER.md                 # This file
```

## Расширенное использование

### Запуск с постоянным хранилищем

Для сохранения аутентификации и работы между перезапусками контейнера:

```bash
# Create a volume for the box user's home directory
docker volume create box-home

# Run with the volume mounted
docker run -it -v box-home:/home/box konard/hive-mind:latest
```

### Запуск в фоновом режиме

```bash
# Start a detached container
docker run -d --name hive-worker -v box-home:/home/box konard/hive-mind:latest sleep infinity

# Execute commands in the running container
docker exec -it hive-worker bash

# Inside the container, run your commands
solve https://github.com/owner/repo/issues/123
```

### Использование с Docker Compose

Создайте `docker-compose.yml`:

```yaml
version: '3.8'
services:
  hive-mind:
    image: konard/hive-mind:latest
    volumes:
      - box-home:/home/box
    stdin_open: true
    tty: true

volumes:
  box-home:
```

Затем запустите:

```bash
docker-compose run --rm hive-mind
```

## Устранение неполадок

### Проблемы с аутентификацией GitHub

```bash
# Inside the container, check authentication status
gh auth status

# Re-authenticate if needed
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Проблемы с аутентификацией Claude

```bash
# Inside the container, re-run Claude to authenticate
claude
```

### Проблемы с Docker

```bash
# Check Docker status on host
docker info

# Pull the latest image
docker pull konard/hive-mind:latest

# Rebuild from source
docker build -t hive-mind:local .
```

### Проблемы со сборкой

Если при локальной сборке образа возникают проблемы:

1. Убедитесь, что у вас достаточно дискового пространства (не менее 20 ГБ свободного)
2. Проверьте интернет-соединение
3. Попробуйте собрать с более подробным выводом:
   ```bash
   docker build -t hive-mind:local --progress=plain .
   ```

## Конфигурация CI/CD для публикации на Docker Hub

Если вы поддерживаете форк или хотите опубликовать в свой аккаунт Docker Hub, выполните следующие шаги для настройки GitHub Actions:

### Шаг 1: Создайте аккаунт Docker Hub

1. Перейдите на [hub.docker.com](https://hub.docker.com)
2. Зарегистрируйтесь или войдите в аккаунт
3. Запомните ваше имя пользователя Docker Hub (например, `konard`)

### Шаг 2: Создайте токен доступа Docker Hub

1. Войдите на [hub.docker.com](https://hub.docker.com)
2. Нажмите на ваше имя пользователя в правом верхнем углу
3. Выберите **Account Settings** → **Security**
4. Нажмите **New Access Token**
5. Введите описание (например, «GitHub Actions - Hive Mind»)
6. Установите права **Read, Write, Delete** (требуется для публикации)
7. Нажмите **Generate**
8. **ВАЖНО:** Скопируйте токен немедленно — вы больше не сможете его увидеть!
   - Пример формата: `dckr_pat_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

### Шаг 3: Добавьте секреты в репозиторий GitHub

1. Перейдите в ваш репозиторий GitHub (например, `https://github.com/konard/hive-mind`)
2. Нажмите **Settings** → **Secrets and variables** → **Actions**
3. Нажмите **New repository secret**
4. Добавьте следующие два секрета:

   **Секрет 1: DOCKERHUB_USERNAME**
   - Name: `DOCKERHUB_USERNAME`
   - Value: Ваше имя пользователя Docker Hub (например, `konard`)
   - Нажмите **Add secret**

   **Секрет 2: DOCKERHUB_TOKEN**
   - Name: `DOCKERHUB_TOKEN`
   - Value: Токен доступа, созданный на шаге 2
   - Нажмите **Add secret**

### Шаг 4: Обновите название Docker-образа

При использовании форка обновите название образа в `.github/workflows/docker-publish.yml`:

```yaml
env:
  REGISTRY: docker.io
  IMAGE_NAME: YOUR_DOCKERHUB_USERNAME/hive-mind # Change this to your username
```

### Шаг 5: Проверьте конфигурацию

1. Отправьте изменения в ветку `main`
2. Перейдите во вкладку **Actions** в вашем репозитории GitHub
3. Найдите рабочий процесс «Docker Build and Publish»
4. Проверьте, что он завершается успешно
5. Убедитесь, что образ появился на [hub.docker.com/r/YOUR_USERNAME/hive-mind](https://hub.docker.com/r/konard/hive-mind)

### Как это работает

- **При Pull Requests:** Рабочий процесс тестирует сборку Docker-образа без публикации
- **В ветке Main:** Рабочий процесс собирает и публикует на Docker Hub с тегом `latest`
- **На тегах версий:** Рабочий процесс публикует с семантическими тегами версий (например, `v0.37.0`, `0.37`, `0`)

### Устранение неполадок CI/CD

**Сборка завершается с ошибкой аутентификации:**

- Проверьте, что `DOCKERHUB_USERNAME` точно совпадает с вашим именем пользователя Docker Hub
- Пересоздайте `DOCKERHUB_TOKEN` и обновите секрет

**Образ опубликован, но не удаётся загрузить:**

- Убедитесь, что репозиторий на Docker Hub публичный (или вы аутентифицированы)
- Проверьте [hub.docker.com](https://hub.docker.com) → Your repositories → hive-mind → Settings → Make Public

**Сборка успешна, но образ не появляется:**

- Проверьте, что вы отправляете в ветку `main` (pull requests только тестируют, не публикуют)
- Убедитесь, что рабочий процесс запустился во вкладке Actions
- Проверьте, не превышены ли ограничения скорости Docker Hub

## Заметки по безопасности

- Каждый контейнер поддерживает собственную изолированную аутентификацию
- Учётные данные не передаются между контейнерами
- Учётные данные не хранятся в самом Docker-образе
- Аутентификация происходит внутри контейнера после его запуска
- Каждый аккаунт GitHub/Claude может иметь собственный экземпляр контейнера
- Токены доступа Docker Hub должны храниться только как секреты GitHub, никогда не фиксироваться в репозитории
