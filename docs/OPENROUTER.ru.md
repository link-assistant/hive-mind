# Руководство по настройке OpenRouter (languages: [en](OPENROUTER.md) • [zh](OPENROUTER.zh.md) • [hi](OPENROUTER.hi.md) • ru)

Это руководство объясняет, как настроить OpenRouter для Claude Code CLI и @link-assistant/agent, что позволяет использовать 500+ AI-моделей от 60+ провайдеров через единый API.

## Содержание

- [Обзор](#обзор)
- [Предварительные требования](#предварительные-требования)
- [Claude Code CLI с OpenRouter](#claude-code-cli-с-openrouter)
- [Agent CLI с OpenRouter](#agent-cli-с-openrouter)
- [Выбор модели](#выбор-модели)
- [Проверка](#проверка)
- [Устранение неполадок](#устранение-неполадок)

## Обзор

OpenRouter предоставляет единый API-шлюз, позволяющий получить доступ к различным AI-моделям без необходимости оформления отдельных подписок. Преимущества:

- **500+ моделей**: Доступ к моделям от OpenAI, Anthropic, Google, Meta и 60+ провайдеров
- **Оплата по факту**: Месячные подписки не требуются
- **Единый API**: Один API-ключ работает со всеми провайдерами
- **Поддержка резервного переключения**: Автоматический переход между провайдерами

## Предварительные требования

1. **Аккаунт OpenRouter**: Зарегистрируйтесь на [openrouter.ai](https://openrouter.ai/)
2. **API-ключ**: Получите API-ключ на странице [OpenRouter Keys](https://openrouter.ai/keys)
3. Установленный **Claude Code CLI** и/или **@link-assistant/agent**

## Claude Code CLI с OpenRouter

Claude Code CLI может подключаться к OpenRouter с использованием нативного протокола Anthropic.

### Шаг 1: Установка переменных окружения

Добавьте это в профиль оболочки (`~/.bashrc`, `~/.zshrc` или `~/.config/fish/config.fish`):

```bash
# Обязательно: направить Claude Code на OpenRouter
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"

# Обязательно: ваш API-ключ OpenRouter
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-your-api-key-here"

# Обязательно: должно быть явно пустым для предотвращения конфликтов
export ANTHROPIC_API_KEY=""
```

### Шаг 2: Настройка модели (необязательно)

Переопределите модели по умолчанию на совместимые с OpenRouter альтернативы:

```bash
# Использовать конкретные модели из OpenRouter
export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4"
export ANTHROPIC_DEFAULT_OPUS_MODEL="anthropic/claude-opus-4"
export ANTHROPIC_SMALL_FAST_MODEL="anthropic/claude-haiku"
```

### Шаг 3: Применение конфигурации

```bash
# Перезагрузить профиль оболочки
source ~/.bashrc  # или ~/.zshrc
```

### Альтернатива: Конфигурация на уровне проекта

Создайте `.claude/settings.local.json` в корне проекта:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-your-api-key-here",
    "ANTHROPIC_API_KEY": ""
  }
}
```

**Примечание**: Добавьте `.claude/settings.local.json` в `.gitignore` для защиты API-ключа.

### Шаг 4: Запуск Claude Code

```bash
cd /path/to/your/project
claude
```

## Agent CLI с OpenRouter

@link-assistant/agent поддерживает OpenRouter через команду `agent auth login` или переменные окружения.

### Метод 1: Интерактивная аутентификация

```bash
# Начать интерактивный вход
agent auth login

# Выбрать "openrouter" из списка провайдеров
# Ввести API-ключ OpenRouter при запросе
```

### Метод 2: Переменная окружения

```bash
export OPENROUTER_API_KEY="sk-or-v1-your-api-key-here"
```

### Метод 3: Прямое использование модели

```bash
# Использовать любую модель OpenRouter с префиксом openrouter/
echo "hello" | agent --model openrouter/anthropic/claude-sonnet-4

# Или использовать модели OpenCode Zen (по умолчанию)
echo "hello" | agent --model opencode/grok-code
```

### Проверка статуса аутентификации

```bash
# Вывести список настроенных учётных данных
agent auth list

# Должно отображаться:
# ◆ openrouter api-key
```

## Выбор модели

### Модели Claude Code CLI через OpenRouter

| Сценарий использования | Переменная окружения             | Пример значения             |
| ---------------------- | -------------------------------- | --------------------------- |
| Основная модель        | `ANTHROPIC_DEFAULT_SONNET_MODEL` | `anthropic/claude-sonnet-4` |
| Мощная модель          | `ANTHROPIC_DEFAULT_OPUS_MODEL`   | `anthropic/claude-opus-4`   |
| Быстрая/дешёвая модель | `ANTHROPIC_SMALL_FAST_MODEL`     | `anthropic/claude-haiku`    |

### Модели Agent CLI через OpenRouter

Используйте префикс `openrouter/`, за которым следуют провайдер и модель:

```bash
# Модели Anthropic
agent --model openrouter/anthropic/claude-sonnet-4

# Модели OpenAI
agent --model openrouter/openai/gpt-4o

# Модели Google
agent --model openrouter/google/gemini-2.0-flash

# Модели Meta
agent --model openrouter/meta-llama/llama-3.1-405b-instruct
```

### Важно: Поддержка использования инструментов

При выборе альтернативных моделей убедитесь, что они поддерживают возможность **использования инструментов**. Claude Code и agent опираются на инструменты для:

- Чтения и записи файлов
- Выполнения команд терминала
- Поиска по кодовой базе
- Выполнения веб-поиска

Модели без поддержки использования инструментов не будут работать корректно.

## Проверка

### Claude Code CLI

Запустите `/status` в Claude Code для проверки соединения:

```
Claude Code v1.x.x
Connected to: openrouter.ai
Model: anthropic/claude-sonnet-4
```

Также проверьте [Дашборд активности OpenRouter](https://openrouter.ai/activity) для просмотра журналов запросов в реальном времени.

### Agent CLI

```bash
# Простой тест
echo "What is 2+2?" | agent --model openrouter/anthropic/claude-sonnet-4

# Проверить настроенные учётные данные
agent auth list
```

## Устранение неполадок

### Ошибка "Authentication failed"

1. Убедитесь в корректности API-ключа на [openrouter.ai/keys](https://openrouter.ai/keys)
2. Убедитесь, что `ANTHROPIC_API_KEY=""` явно установлена (пустая) для Claude Code
3. Проверьте опечатки в значении `ANTHROPIC_AUTH_TOKEN`

### Ошибка "Model not found"

1. Проверьте идентификатор модели на [openrouter.ai/models](https://openrouter.ai/models)
2. Используйте полный путь модели: `provider/model-name`
3. Убедитесь, что модель доступна в вашем регионе

### Ошибка "Insufficient credits"

1. Пополните счёт на [openrouter.ai/credits](https://openrouter.ai/credits)
2. Проверьте использование на [openrouter.ai/activity](https://openrouter.ai/activity)

### Claude Code не использует OpenRouter

Проверьте установку переменных окружения:

```bash
echo $ANTHROPIC_BASE_URL
# Должно выводить: https://openrouter.ai/api

echo $ANTHROPIC_AUTH_TOKEN
# Должно выводить: sk-or-v1-...

echo $ANTHROPIC_API_KEY
# Должно быть пустым
```

### Проблемы с аутентификацией Agent CLI

```bash
# Удалить существующие учётные данные
agent auth logout
# Выбрать "openrouter"

# Повторно пройти аутентификацию
agent auth login
# Выбрать "openrouter" и ввести API-ключ
```

## Рекомендации по безопасности

1. **Никогда не коммитьте API-ключи**: Добавляйте файлы конфигурации в `.gitignore`
2. **Используйте переменные окружения**: Предпочтительнее профиль оболочки, чем файлы проекта
3. **Регулярно ротируйте ключи**: Генерируйте новые ключи на [openrouter.ai/keys](https://openrouter.ai/keys)
4. **Следите за использованием**: Проверяйте [дашборд активности](https://openrouter.ai/activity) на предмет подозрительных запросов

## Ссылки

- [Документация OpenRouter](https://openrouter.ai/docs)
- [Модели OpenRouter](https://openrouter.ai/models)
- [Claude Code CLI](https://claude.ai/code)
- [@link-assistant/agent](https://github.com/link-assistant/agent)
