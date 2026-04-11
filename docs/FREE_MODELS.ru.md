# Поддержка бесплатных моделей в Hive-Mind (languages: [en](FREE_MODELS.md) • [zh](FREE_MODELS.zh.md) • [hi](FREE_MODELS.hi.md) • ru)

Этот документ содержит исчерпывающую информацию о бесплатных моделях, поддерживаемых hive-mind при использовании опции `--tool agent`.

> **Последнее обновление:** 10 апреля 2026 г.
> **Связанные материалы:**
>
> - [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) — Список бесплатных моделей upstream (канонический источник)
> - [Agent PR #243](https://github.com/link-assistant/agent/pull/243) — Upstream: замена устаревшей qwen3.6-plus-free на nemotron-3-super-free в качестве модели по умолчанию
> - [Agent PR #234](https://github.com/link-assistant/agent/pull/234) — Upstream: qwen3.6-plus-free как модель по умолчанию, добавлена nemotron-3-super-free
> - [Agent PR #209](https://github.com/link-assistant/agent/pull/209) — Upstream: обновления бесплатных моделей (minimax-m2.5-free как модель по умолчанию)
> - [Agent Issue #208](https://github.com/link-assistant/agent/issues/208) — kimi-k2.5-free удалена из OpenCode Zen

## Доступные бесплатные модели

Hive-mind поддерживает бесплатные модели от двух провайдеров:

1. **OpenCode Zen** — 4 бесплатные модели с префиксом `opencode/`
2. **Kilo Gateway** — 6 бесплатных моделей с префиксом `kilo/` (Issue #1282)

---

## Бесплатные модели OpenCode Zen

### 1. opencode/nemotron-3-super-free **Модель по умолчанию**

- **Краткий псевдоним**: `nemotron-3-super-free`
- **Провайдер**: OpenCode Zen
- **Статус**: Полностью поддерживается (По умолчанию для `--tool agent` начиная с Issue #1563)
- **Возможности**: Рассуждение, вызов инструментов, гибридная архитектура Mamba-Transformer
- **Контекстное окно**: ~262 144 токенов
- **Лимит вывода**: 262 144 токенов
- **Стоимость**: Бесплатно (без платы за ввод/вывод)
- **Дата среза знаний**: Январь 2025
- **Дата релиза**: Март 2026
- **Открытые веса**: Да
- **Примечания**: Гибридная NVIDIA MoE-архитектура Mamba-Transformer, сильные возможности рассуждения

### 2. opencode/minimax-m2.5-free

- **Краткий псевдоним**: `minimax-m2.5-free`
- **Провайдер**: OpenCode Zen
- **Статус**: Полностью поддерживается (Бывшая модель по умолчанию, Issues #1391, #1543)
- **Возможности**: Рассуждение, вызов инструментов, управление температурой
- **Контекстное окно**: 204 800 токенов
- **Лимит вывода**: 131 072 токенов
- **Стоимость**: Бесплатно (без платы за ввод/вывод)
- **Дата среза знаний**: Январь 2025
- **Дата релиза**: Февраль 2026
- **Открытые веса**: Да

### 3. opencode/gpt-5-nano

- **Краткий псевдоним**: `gpt-5-nano`
- **Провайдер**: OpenCode Zen
- **Статус**: Полностью поддерживается
- **Возможности**: Рассуждение, вызов инструментов, структурированный вывод, управление температурой
- **Контекстное окно**: ~400 000 токенов
- **Лимит вывода**: 128 000 токенов
- **Стоимость**: Бесплатно (без платы за ввод/вывод)
- **Дата среза знаний**: Январь 2025

### 4. opencode/big-pickle

- **Краткий псевдоним**: `big-pickle`
- **Провайдер**: OpenCode Zen
- **Статус**: Полностью поддерживается
- **Возможности**: Рассуждение, вызов инструментов, управление температурой
- **Контекстное окно**: ~200 000 токенов
- **Лимит вывода**: 128 000 токенов
- **Стоимость**: Бесплатно (без платы за ввод/вывод)
- **Дата среза знаний**: Январь 2025

---

## Снятые с поддержки бесплатные модели OpenCode Zen

Следующие модели ранее были бесплатными, но больше недоступны:

| Модель             | Бывший идентификатор         | Статус                                                                                                                                                  |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen 3.6 Plus Free | `opencode/qwen3.6-plus-free` | Бесплатная акция завершилась (апрель 2026) — теперь требуется подписка OpenCode Go. См. [agent#242](https://github.com/link-assistant/agent/issues/242) |
| Kimi K2.5 Free     | `opencode/kimi-k2.5-free`    | Удалена из OpenCode Zen (март 2026) — см. [agent#208](https://github.com/link-assistant/agent/issues/208)                                               |
| Grok Code Fast 1   | `opencode/grok-code`         | Снята с поддержки в январе 2026                                                                                                                         |
| MiniMax M2.1 Free  | `opencode/minimax-m2.1-free` | Заменена на `opencode/minimax-m2.5-free`                                                                                                                |
| GLM 4.7 Free       | `opencode/glm-4.7-free`      | Больше не бесплатна в OpenCode Zen                                                                                                                      |

> **Примечание:** Актуальный список бесплатных моделей см. в [документации OpenCode Zen](https://opencode.ai/docs/zen/) и [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md).

---

## Бесплатные модели Kilo Gateway

[Kilo Gateway](https://kilo.ai) предоставляет доступ к 500+ AI-моделям через API, совместимый с OpenAI. Следующие бесплатные модели доступны без настройки API-ключа.

> **Примечание:** Эксклюзивные модели Kilo (модели, доступные только через Kilo Gateway) поддерживают краткие псевдонимы без префикса `kilo/`. Например, вы можете использовать `glm-5-free` вместо `kilo/glm-5-free`, поскольку эта модель уникальна для Kilo.

### 1. kilo/glm-5-free **Рекомендуется для Kilo**

- **Идентификатор модели**: `kilo/glm-5-free`
- **Краткий псевдоним**: `glm-5-free` (эксклюзивная модель Kilo)
- **Провайдер**: Kilo Gateway (Z.AI)
- **Статус**: Полностью поддерживается (Бесплатно на ограниченный срок)
- **Возможности**: Глубокое рассуждение, быстрый инференс, двуязычность (китайский/английский), вызов инструментов, структурированный вывод
- **Контекстное окно**: 202 752 токенов
- **Лимит вывода**: 131 072 токенов
- **Стоимость**: Бесплатно (предложение ограниченного срока)
- **Дата релиза**: 11 февраля 2026
- **Особые возможности**: "Соответствует Opus 4.5 во многих задачах" — [Kilo Blog](https://blog.kilo.ai/p/glm-5-free-limited-time)

### 2. kilo/glm-4.5-air-free

- **Идентификатор модели**: `kilo/glm-4.5-air-free`
- **Краткий псевдоним**: `glm-4.5-air-free` (эксклюзивная модель Kilo)
- **Провайдер**: Kilo Gateway (Z.AI)
- **Статус**: Полностью поддерживается
- **Возможности**: Ориентирована на агенты, облегчённая, быстрый инференс
- **Контекстное окно**: 131 072 токенов
- **Лимит вывода**: 65 536 токенов
- **Стоимость**: Бесплатно

### 3. kilo/minimax-m2.5-free

- **Идентификатор модели**: `kilo/minimax-m2.5-free`
- **Провайдер**: Kilo Gateway (MiniMax)
- **Статус**: Полностью поддерживается (обновлена с M2.1)
- **Возможности**: Высокая производительность общего назначения
- **Контекстное окно**: 204 800 токенов
- **Лимит вывода**: 131 072 токенов
- **Стоимость**: Бесплатно

### 4. kilo/deepseek-r1-free

- **Идентификатор модели**: `kilo/deepseek-r1-free`
- **Краткий псевдоним**: `deepseek-r1-free` (эксклюзивная модель Kilo)
- **Провайдер**: Kilo Gateway (DeepSeek)
- **Статус**: Полностью поддерживается
- **Возможности**: Продвинутое рассуждение, открытый исходный код, полностью открытые токены рассуждения
- **Контекстное окно**: 163 840 токенов
- **Лимит вывода**: 65 536 токенов
- **Стоимость**: Бесплатно

### 5. kilo/giga-potato-free

- **Идентификатор модели**: `kilo/giga-potato-free`
- **Краткий псевдоним**: `giga-potato-free` (эксклюзивная модель Kilo)
- **Провайдер**: Kilo Gateway
- **Статус**: Полностью поддерживается (Период оценки)
- **Возможности**: Оценочная модель общего назначения
- **Контекстное окно**: 256 000 токенов
- **Лимит вывода**: 131 072 токенов
- **Стоимость**: Бесплатно (в период оценки)

### 6. kilo/trinity-large-preview

- **Идентификатор модели**: `kilo/trinity-large-preview`
- **Краткий псевдоним**: `trinity-large-preview` (эксклюзивная модель Kilo)
- **Провайдер**: Kilo Gateway (Arcee AI)
- **Статус**: Полностью поддерживается (Предварительный просмотр)
- **Возможности**: Высокие возможности, предварительная версия модели
- **Контекстное окно**: 131 000 токенов
- **Лимит вывода**: 65 536 токенов
- **Стоимость**: Бесплатно (предварительный просмотр)

---

---

## Снятые с поддержки бесплатные модели Kilo Gateway

Следующие модели Kilo ранее были рекомендованными бесплатными, но были обновлены:

| Модель       | Бывший идентификатор     | Статус                                     |
| ------------ | ------------------------ | ------------------------------------------ |
| GLM 4.7      | `kilo/glm-4.7-free`      | Заменена на `kilo/glm-4.5-air-free`        |
| Kimi K2.5    | `kilo/kimi-k2.5-free`    | Заменена другими бесплатными моделями Kilo |
| MiniMax M2.1 | `kilo/minimax-m2.1-free` | Заменена на `kilo/minimax-m2.5-free`       |

> **Примечание:** Актуальную информацию о доступности см. в [документации по бесплатным моделям Kilo](https://kilo.ai/docs/advanced-usage/free-and-budget-models).

---

## Примеры использования

### Использование в командной строке

```bash
# Модели OpenCode Zen (краткие псевдонимы без префикса)
solve https://github.com/owner/repo/issues/123 --tool agent --model nemotron-3-super-free
hive https://github.com/owner/repo --tool agent --model minimax-m2.5-free

# Модели OpenCode Zen (полные идентификаторы)
solve https://github.com/owner/repo/issues/123 --tool agent --model opencode/nemotron-3-super-free
hive https://github.com/owner/repo --tool agent --model opencode/big-pickle

# Модели Kilo Gateway (полные идентификаторы)
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
hive https://github.com/owner/repo --tool agent --model kilo/deepseek-r1-free

# Эксклюзивные модели Kilo (краткие псевдонимы без префикса kilo/)
solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
hive https://github.com/owner/repo --tool agent --model deepseek-r1-free
```

### Использование в Telegram-боте

```bash
# Модели OpenCode Zen (краткие псевдонимы)
/solve https://github.com/owner/repo/issues/123 --tool agent --model nemotron-3-super-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model minimax-m2.5-free

# Модели Kilo Gateway (полные идентификаторы)
/solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
/hive https://github.com/owner/repo --tool agent --model kilo/glm-4.5-air-free

# Эксклюзивные модели Kilo (краткие псевдонимы без префикса kilo/)
/solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
/hive https://github.com/owner/repo --tool agent --model glm-4.5-air-free

# Модель по умолчанию (nemotron-3-super-free через OpenCode Zen):
/solve https://github.com/owner/repo/issues/123 --tool agent
```

### Прямое использование Agent CLI

```bash
# Модели OpenCode Zen
echo "Your prompt here" | agent --model opencode/nemotron-3-super-free
echo "Your prompt here" | agent --model opencode/minimax-m2.5-free

# Модели Kilo Gateway
echo "Your prompt here" | agent --model kilo/glm-5-free
echo "Your prompt here" | agent --model kilo/deepseek-r1-free
```

---

## Руководство по выбору модели

### Для различных сценариев использования

**Флагманские бесплатные модели**:

- `opencode/nemotron-3-super-free` — гибридная NVIDIA Mamba-Transformer, сильное рассуждение (OpenCode, по умолчанию)
- `kilo/glm-5-free` — флагман Z.AI, соответствует Opus 4.5 во многих задачах (Kilo)

**Общего назначения и рассуждение**:

- `opencode/gpt-5-nano` — сильные возможности общего рассуждения
- `opencode/big-pickle` — хорошо сбалансированная производительность
- `kilo/minimax-m2.5-free` — высокая производительность общего назначения
- `kilo/deepseek-r1-free` — модель продвинутого рассуждения

**Для задач с большим контекстом**:

- `opencode/gpt-5-nano` — очень большой контекст (~400 000 токенов)
- `opencode/nemotron-3-super-free` — большой контекст (~262 144 токенов)
- `kilo/giga-potato-free` — большой контекст (256 000 токенов)
- `opencode/minimax-m2.5-free` — большой контекст (204 800 токенов)

**Ориентированные на агентов / программирование**:

- `kilo/glm-4.5-air-free` — создана специально для приложений на основе агентов
- `kilo/deepseek-r1-free` — оптимизирована для рассуждений и синтеза кода
- `opencode/minimax-m2.5-free` — высокая производительность в программировании

---

## Сравнение провайдеров

| Характеристика      | OpenCode Zen                           | Kilo Gateway               |
| ------------------- | -------------------------------------- | -------------------------- |
| Бесплатных моделей  | 4 модели                               | 6 моделей                  |
| Модель по умолчанию | nemotron-3-super-free (~262K контекст) | glm-5-free (рекомендуется) |
| Формат API          | Совместимый с OpenAI                   | Совместимый с OpenAI       |
| Бесплатный API-ключ | `public`                               | `public`                   |
| Всего моделей       | 50+                                    | 500+                       |
| Флагман (бесплатно) | Nemotron 3 Super (~262K контекст)      | GLM-5 (ограниченный срок)  |
| Поддержка BYOK      | Да                                     | Да                         |
| Новые модели        | Nemotron 3 Super (Issue #1543, #1563)  | DeepSeek R1, GLM 4.5 Air   |

---

## Тестирование и валидация

Все бесплатные модели были протестированы и проверены на:

1. **Конфигурацию модели**: Все модели корректно настроены в `src/models/index.mjs`
2. **Интеграцию с CLI**: Все модели принимаются как hive-mind, так и agent CLI
3. **Совместимость с инструментами**: Все модели совместимы с опцией `--tool agent`
4. **Нечувствительность к регистру**: Модели можно указывать в любом регистре (например, `KILO/GLM-5-FREE`)
5. **Поддержку псевдонимов**: Краткие псевдонимы работают для всех моделей

---

## Обработка ошибок

При возникновении проблем с любой из этих моделей:

1. **Проверьте написание модели**: Убедитесь в использовании точного имени модели или псевдонима
2. **Обновите зависимости**: Запустите `npm install` для получения последней версии agent CLI
3. **Проверьте сеть**: Некоторые модели могут требовать подключения к интернету при первоначальной настройке
4. **Проверьте провайдера**: Убедитесь в корректности префикса провайдера (`opencode/` или `kilo/`)

---

## Связанная документация

- [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) — Канонический список бесплатных моделей upstream
- [Models Module](../src/models/index.mjs) — Единые данные модели, валидация, маппинг и информация
- [Agent CLI Documentation](https://github.com/link-assistant/agent) — Прямое использование agent CLI
- [Agent Kilo Documentation](https://github.com/link-assistant/agent/blob/main/docs/kilo.md) — Детали Kilo Gateway
- [Case Study: Issue #1282](./case-studies/issue-1282/README.md) — Анализ интеграции моделей Kilo
- [Case Study: Issue #1300](./case-studies/issue-1300/README.md) — Обновление бесплатных моделей (MiniMax M2.5, DeepSeek R1)
- [Case Study: Issue #1391](./case-studies/issue-1391/README.md) — Обновление бесплатных моделей (minimax-m2.5-free как по умолчанию, kimi-k2.5-free устарела)
- [Case Study: Issue #1473](./case-studies/issue-1473/README.md) — Исправление распознавания моделей и синхронизация бесплатных моделей
- [Case Study: Issue #1543](./case-studies/issue-1543/README.md) — Обновление бесплатных моделей (qwen3.6-plus-free как по умолчанию, добавлена nemotron-3-super-free)
- [Case Study: Issue #1563](./case-studies/issue-1563/README.md) — Обновление бесплатных моделей (qwen3.6-plus-free устарела, nemotron-3-super-free как по умолчанию)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/) — Детали провайдера OpenCode Zen
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway) — Детали провайдера Kilo Gateway

---

**Последнее обновление**: 10 апреля 2026 г.
**Версия Hive-Mind**: 1.48.2
**Версия Agent CLI**: Последняя (с обновлениями бесплатных моделей из PR #243)
