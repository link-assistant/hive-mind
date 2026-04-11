# Документация потока данных Hive Mind (languages: [en](flow.md) • [zh](flow.zh.md) • [hi](flow.hi.md) • ru)

Этот всесторонний документ описывает поток данных в Hive Mind, явно указывая все точки, где обратная связь от человека интегрируется в рабочий процесс системы.

## Содержание

1. [Обзор](#обзор)
2. [Режимы работы](#режимы-работы)
3. [Архитектура потока данных](#архитектура-потока-данных)
4. [Режим 1: Режим по умолчанию](#режим-1-режим-по-умолчанию-issue--pull-request)
5. [Режим 2: Режим продолжения](#режим-2-режим-продолжения-pull-request--комментарии)
6. [Точки интеграции обратной связи от человека](#точки-интеграции-обратной-связи-от-человека)
7. [Параметры конфигурации](#параметры-конфигурации)
8. [Обработка ошибок и резервные варианты](#обработка-ошибок-и-резервные-варианты)
9. [Детали реализации](#детали-реализации)
10. [Итог](#итог)

## Обзор

Hive Mind — это система совместной разработки на основе ИИ, работающая через GitHub, которая обеспечивает контроль человека в критических точках принятия решений, автоматизируя при этом разработку решений. Система гарантирует, что обратная связь от человека остаётся центральной в процессе разработки через несколько точек интеграции.

## Режимы работы

Hive Mind работает в двух основных режимах в зависимости от точки входа и паттернов взаимодействия с человеком:

| Режим                     | Точка входа    | Основной ввод от человека        | Дополнительный ввод         | Точки принятия решений     |
| ------------------------- | -------------- | -------------------------------- | --------------------------- | -------------------------- |
| **Режим по умолчанию**    | GitHub Issue   | Описание задачи и требования     | Комментарии к PR для уточнений | Слияние/запрос изменений/закрытие |
| **Режим продолжения**     | Существующий PR | Комментарии к PR с обратной связью | Дополнительные комментарии к PR | Слияние/запрос изменений/закрытие |

## Архитектура потока данных

### Высокоуровневая архитектура системы

```mermaid
graph TB
    subgraph "Human Interaction Layer"
        H1[Human Developer]
        H2[GitHub Interface]
    end

    subgraph "GitHub Platform"
        GI[GitHub Issues]
        GP[GitHub Pull Requests]
        GC[GitHub Comments]
        GA[GitHub Actions/Webhooks]
    end

    subgraph "Hive Mind Core"
        HM[Hive Mind Controller]
        AM[Agent Manager]
        FM[Feedback Monitor]
        SM[State Manager]
    end

    subgraph "AI Processing Layer"
        AI[AI Agent Claude/GPT]
        CD[Code Developer]
        CR[Code Reviewer]
        TG[Test Generator]
    end

    H1 -->|Creates/Comments| H2
    H2 --> GI
    H2 --> GP
    H2 --> GC

    GA -->|Triggers| HM
    HM -->|Monitors| FM
    FM -->|Detects Changes| GI
    FM -->|Detects Changes| GP
    FM -->|Detects Changes| GC

    HM -->|Assigns Tasks| AM
    AM -->|Coordinates| AI
    AI --> CD
    AI --> CR
    AI --> TG

    CD -->|Pushes Code| GP
    CR -->|Adds Reviews| GP
    TG -->|Adds Tests| GP

    SM -->|Tracks State| HM

    style H1 fill:#e1f5fe
    style H2 fill:#e1f5fe
    style GI fill:#fff3e0
    style GP fill:#fff3e0
    style GC fill:#fff3e0
    style HM fill:#e8f5e9
    style FM fill:#e8f5e9
    style AI fill:#f3e5f5
```

### Детальный поток данных

```mermaid
graph TD
    A[Human Input] --> B{Entry Point}
    B -->|New Issue| C[Default Mode]
    B -->|Existing PR| D[Continue Mode]

    subgraph "Default Mode Flow"
        C --> E[Issue Analysis]
        E --> F[Solution Development]
        F --> G[Create Draft PR]
        G --> H{Human Decision Point}
    end

    subgraph "Continue Mode Flow"
        D --> L[PR Analysis]
        L --> M[Comment Processing]
        M --> N{New Comments?}
        N -->|Yes| O[Update Solution]
        N -->|No| P[No Action]
        O --> Q[Push Changes]
    end

    subgraph "Decision Outcomes"
        H -->|Approve| I[Merge PR]
        H -->|Request Changes| J[Add PR Comments]
        H -->|Close| K[Close PR]
    end

    Q --> H
    J --> D
    I --> R[Complete]
    K --> S[End]
    P --> S

    style A fill:#bbdefb
    style H fill:#ffccbc
    style J fill:#fff9c4
    style I fill:#c8e6c9
    style K fill:#ffcdd2
```

## Режим 1: Режим по умолчанию (Issue → Pull Request)

### Точки обратной связи от человека

- **Основной ввод**: Описание задачи GitHub и требования
- **Точка принятия решения**: Слияние, запрос изменений или закрытие PR
- **Дополнительный ввод**: Комментарии к PR для уточнений

### Диаграмма последовательности

```mermaid
sequenceDiagram
    participant H as Human
    participant GH as GitHub
    participant AI as AI Agent
    participant HM as Hive Mind

    H->>GH: Creates Issue
    Note over H,GH: Primary human input

    GH->>HM: Issue Available
    HM->>AI: Assigns Issue
    AI->>GH: Analyzes Issue
    AI->>AI: Develops Solution
    AI->>GH: Creates Draft PR

    Note over H,GH: Human decision point
    GH->>H: Notifies PR Created
    H->>GH: Reviews PR

    alt Approve & Merge
        H->>GH: Merges PR
        GH->>HM: PR Merged
    else Request Changes
        H->>GH: Adds Comments
        Note over H,GH: Secondary human input
        GH->>HM: Comments Added
        HM->>AI: Process Feedback
        AI->>GH: Updates PR
    else Close PR
        H->>GH: Closes PR
        GH->>HM: PR Closed
    end
```

### Шаги потока данных

1. **Человек создаёт задачу GitHub** (основной ввод от человека)
2. Hive Mind обнаруживает задачу и назначает её агенту ИИ
3. Агент ИИ анализирует требования задачи
4. Агент ИИ разрабатывает решение и создаёт черновик PR
5. **Человек проверяет PR** (точка принятия решения человеком)
6. **Человек принимает решение**: слияние, запрос изменений или закрытие (обратная связь от человека)
7. При запросе изменений цикл продолжается с комментариями к PR в качестве ввода

## Режим 2: Режим продолжения (Pull Request → Комментарии)

### Точки обратной связи от человека

- **Основной ввод**: Комментарии к существующему PR
- **Точка принятия решения**: Та же, что и в режиме 1 (слияние, запрос изменений или закрытие)
- **Триггер**: Обнаружение новых комментариев или обратной связи

### Диаграмма последовательности

```mermaid
sequenceDiagram
    participant H as Human
    participant GH as GitHub
    participant AI as AI Agent
    participant HM as Hive Mind

    Note over GH: Existing PR
    H->>GH: Adds Comment
    Note over H,GH: Primary human input

    GH->>HM: New Comment Available
    HM->>AI: Processes Comment
    AI->>GH: Analyzes Feedback
    AI->>AI: Updates Solution
    AI->>GH: Pushes Changes

    Note over H,GH: Human decision point
    GH->>H: Notifies Changes
    H->>GH: Reviews Updates

    alt Approve & Merge
        H->>GH: Merges PR
        GH->>HM: PR Merged
    else More Changes Needed
        H->>GH: Adds More Comments
        Note over H,GH: Continued human input
        GH->>HM: Comments Added
    else Close PR
        H->>GH: Closes PR
        GH->>HM: PR Closed
    end
```

### Шаги потока данных

1. **Человек добавляет комментарий к существующему PR** (основной ввод от человека)
2. Hive Mind обнаруживает новый комментарий
3. Агент ИИ обрабатывает комментарий и обратную связь
4. Агент ИИ обновляет решение на основе обратной связи
5. Агент ИИ отправляет изменения в PR
6. **Человек проверяет обновления** (точка принятия решения человеком)
7. **Человек принимает решение**: слияние, добавление комментариев или закрытие (обратная связь от человека)
8. Цикл продолжается до разрешения

## Точки интеграции обратной связи от человека

### Комплексная матрица точек обратной связи

| Точка обратной связи     | Режим      | Момент      | Тип ввода               | Реакция системы             | Уровень воздействия         |
| ------------------------ | ---------- | ----------- | ----------------------- | --------------------------- | --------------------------- |
| **Создание задачи**      | По умолчанию | Начальный | Требования, описание    | Запускает разработку решения | Высокий — определяет весь объём |
| **Комментарии к задаче** | По умолчанию | Непрерывный | Уточнения, обновления  | Обновляет требования        | Средний — уточняет объём    |
| **Проверка создания PR** | Оба        | После черновика | Начальная оценка      | Определяет продолжение      | Высокий — решение о продолжении |
| **Комментарии к PR**     | Оба        | Итеративный | Техническая обратная связь | Запускает обновления кода | Высокий — направляет изменения |
| **Code Review**          | Оба        | За коммит   | Постострочная обратная связь | Точные изменения          | Средний — конкретные исправления |
| **Одобрение PR**         | Оба        | Финальный   | Решение о принятии      | Разрешает слияние           | Критический — финальный шлюз |
| **Отклонение PR**        | Оба        | В любое время | Сигнал остановки      | Останавливает процесс       | Критический — полная остановка |
| **Изменения меток**      | Оба        | В любое время | Обновления приоритета/статуса | Корректирует подход      | Низкий — подсказки процессу |

### 1. Создание задачи (вход в режим 1)

- **Тип**: Спецификация требований
- **Формат**: Описание задачи GitHub, метки, начальные комментарии
- **Воздействие**: Определяет объём и требования для решения ИИ
- **Доступные действия человека**:
  - Написать подробные требования
  - Прикрепить примеры или спецификации
  - Установить метки приоритета
  - Назначить конкретным агентам
  - Связать с похожими задачами

### 2. Проверка PR и принятие решения (оба режима)

- **Тип**: Решение об одобрении/отклонении
- **Формат**: Слияние PR, закрытие или комментарии
- **Воздействие**: Определяет, приемлемо ли решение или требует уточнений
- **Доступные действия человека**:
  - Одобрить и слить
  - Запросить изменения с конкретной обратной связью
  - Закрыть без слияния
  - Перевести в черновик
  - Назначить дополнительных рецензентов

### 3. Комментарии к PR (основные в режиме 2, дополнительные в режиме 1)

- **Тип**: Конкретная обратная связь и запросы изменений
- **Формат**: Комментарии к PR на GitHub с техническими деталями
- **Воздействие**: Направляет уточнения и итерации агента ИИ
- **Доступные действия человека**:
  - Постострочные комментарии к коду
  - Общее обсуждение PR
  - Предложение конкретных изменений
  - Запрос тестов или документации
  - Запрос уточнений

### 4. Непрерывный мониторинг (оба режима)

- **Тип**: Непрерывный контроль
- **Формат**: Изменения статуса PR, дополнительные комментарии
- **Воздействие**: Обеспечивает итерационные циклы улучшения
- **Доступные действия человека**:
  - Мониторинг результатов CI/CD
  - Просмотр результатов автоматических тестов
  - Проверка метрик качества кода
  - Валидация по требованиям
  - Предоставление текущих указаний

### 5. Точки экстренного вмешательства

- **Тип**: Критическая обратная связь
- **Формат**: Прямые команды в комментариях
- **Воздействие**: Немедленная реакция системы
- **Триггеры**:
  - Команда `STOP` в комментарии
  - Закрытие PR
  - Активация защиты ветки
  - Ручной откат

### Поток обработки обратной связи от человека

```mermaid
stateDiagram-v2
    [*] --> AwaitingFeedback
    AwaitingFeedback --> ProcessingFeedback: Human Input Received

    ProcessingFeedback --> ClassifyingFeedback: Parse Input
    ClassifyingFeedback --> TechnicalChange: Code Change Request
    ClassifyingFeedback --> Clarification: Question/Unclear
    ClassifyingFeedback --> Approval: Positive Feedback
    ClassifyingFeedback --> Rejection: Negative Feedback

    TechnicalChange --> ImplementingChange: Generate Solution
    ImplementingChange --> PushingChanges: Test & Validate
    PushingChanges --> AwaitingFeedback: Await Review

    Clarification --> RequestingInfo: Ask Questions
    RequestingInfo --> AwaitingFeedback: Wait for Response

    Approval --> Merging: Proceed to Merge
    Merging --> [*]: Complete

    Rejection --> Analyzing: Understand Issues
    Analyzing --> ImplementingChange: Fix Issues
    Analyzing --> Closing: Cannot Fix
    Closing --> [*]: End
```

## Параметры конфигурации

### Поведение автопродолжения

- `--auto-continue`: Автоматически продолжать с существующими PR для задач (включено по умолчанию, используйте `--no-auto-continue` для отключения)
- `--auto-continue-only-on-new-comments`: Продолжать только при обнаружении новых комментариев
- `--continue-only-on-feedback`: Продолжать только при наличии обратной связи

### Элементы управления взаимодействием с человеком

- `--auto-pull-request-creation`: Создать черновик PR до проверки человеком
- `--attach-logs`: Включить подробные журналы для проверки человеком
- Требование ручного слияния обеспечивает контроль человека

## Обработка ошибок и резервные варианты

### Когда обратная связь от человека отсутствует

- Система ожидает ввода, а не продолжает работу
- Черновики PR остаются в состоянии черновика до действий человека
- Функции автопродолжения соблюдают требования к обратной связи

### Когда обратная связь от человека неоднозначна

- ИИ запрашивает уточнения через комментарии к PR
- Несколько предложений решений для выбора человеком
- Консервативный подход при наличии неопределённости

## Детали реализации

### Интерфейс командной строки

Система предоставляет различные параметры командной строки для управления взаимодействием с человеком:

```bash
# Default Mode - Issue to PR
./solve.mjs "https://github.com/owner/repo/issues/123"

# Continue Mode - PR with comments
./solve.mjs "https://github.com/owner/repo/pull/456"

# Continue only when new comments are detected (--auto-continue is enabled by default)
./solve.mjs "https://github.com/owner/repo/issues/123" \
  --auto-continue-only-on-new-comments

# Continue only when feedback is present
./solve.mjs "https://github.com/owner/repo/pull/456" \
  --continue-only-on-feedback
```

### Алгоритм обнаружения обратной связи

```mermaid
flowchart TD
    A[Start Feedback Check] --> B{Check PR/Issue}
    B --> C[Fetch Comments]
    C --> D[Get Last Commit Time]
    D --> E{Comments After Commit?}

    E -->|Yes| F[Count New Comments]
    E -->|No| G[No New Feedback]

    F --> H{Feedback Type}
    H -->|Technical| I[Process Technical Feedback]
    H -->|Question| J[Process Clarification]
    H -->|Approval| K[Process Approval]

    I --> L[Generate Changes]
    J --> M[Request Information]
    K --> N[Proceed to Merge]

    G --> O{Continue Mode Settings}
    O -->|Force Continue| P[Continue Anyway]
    O -->|Require Feedback| Q[Exit with Message]

    L --> R[Push Updates]
    M --> R
    N --> S[Complete]
    P --> R
    Q --> T[Wait for Human Input]
```

### Управление состоянием

Система поддерживает состояние между сессиями для обеспечения непрерывности:

| Элемент состояния | Хранилище       | Назначение                          | Сохранность     |
| ----------------- | --------------- | ----------------------------------- | --------------- |
| Session ID        | Файловая система | Отслеживание контекста разговора   | До завершения   |
| PR Number         | Память/Args     | Связь задачи с PR                   | Во время работы |
| Comment History   | GitHub API      | Отслеживание новой и старой обратной связи | Постоянно |
| Commit History    | Git             | Определение времени обратной связи | Постоянно       |
| Configuration     | CLI Args        | Управление поведением               | За выполнение   |

## Итог

### Ключевые принципы проектирования

1. **Ориентированность на человека**: Каждое автоматизированное действие подлежит проверке и одобрению человеком
2. **Управляемость обратной связью**: Система динамически реагирует на ввод человека в нескольких точках
3. **Прозрачность**: Все действия ИИ видны через стандартные интерфейсы GitHub
4. **Итеративность**: Поддерживает несколько раундов уточнений на основе обратной связи от человека
5. **Конфигурируемость**: Поведение может быть настроено под рабочие процессы команды

### Сводка потока данных

Архитектура потока данных Hive Mind обеспечивает всесторонний контроль человека через:

- **Множество точек входа**: Задачи (режим по умолчанию) или PR (режим продолжения)
- **Непрерывная интеграция обратной связи**: Комментарии обрабатываются в режиме реального времени
- **Чёткие шлюзы принятия решений**: Для слияния требуется явное одобрение человека
- **Элементы экстренного управления**: Возможность немедленной остановки через команды
- **Гибкая конфигурация**: Настраиваемые уровни автоматизации

### Интеграция обратной связи от человека

| Режим                  | Основная обратная связь | Дополнительная обратная связь | Орган принятия решений |
| ---------------------- | ----------------------- | ----------------------------- | ---------------------- |
| **Режим по умолчанию** | Требования задачи       | Комментарии к PR              | Решение человека о слиянии |
| **Режим продолжения**  | Комментарии к PR        | Дополнительные комментарии    | Решение человека о слиянии |

Оба режима сохраняют за человеком право принимать критические решения, используя ИИ для реализации, гарантируя, что обратная связь от человека остаётся краеугольным камнем процесса разработки.
