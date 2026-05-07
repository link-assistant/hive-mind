# Лучшие практики AI-driven разработки (languages: [en](BEST-PRACTICES.md) • [zh](BEST-PRACTICES.zh.md) • [hi](BEST-PRACTICES.hi.md) • ru)

Этот документ описывает общие лучшие практики для эффективной работы с Hive Mind и AI-driven рабочими процессами разработки. Он охватывает универсальные стратегии промптинга, руководства по написанию задач, принципы архитектуры и ссылки на стандарты CI/CD.

## Содержание

- [Почему важны лучшие практики](#почему-важны-лучшие-практики)
- [Универсальные промпты](#универсальные-промпты)
- [Написание хороших задач](#написание-хороших-задач)
- [Улучшение архитектуры](#улучшение-архитектуры)
- [Лучшие практики CI/CD](#лучшие-практики-cicd)
- [Использование субагентов](#использование-субагентов)
- [Ссылки](#ссылки)

## Почему важны лучшие практики

Качество Hive Mind во многом зависит от:

1. **Чётких требований к задачам** — Неоднозначные задачи дают неоднозначные решения
2. **Надёжных CI/CD-пайплайнов** — AI-решатели итерируют пока все проверки не пройдут, гарантируя качество
3. **Хорошего промптинга** — Универсальные промпты помогают AI делать глубокий анализ и избегать распространённых ошибок
4. **Архитектурной дисциплины** — Последовательная структура кода проще для AI для навигации и расширения

Каждый из этих слоёв усиливает другие: хорошие требования + надёжный CI/CD + хорошие промпты = стабильно отличные автоматизированные решения.

## Универсальные промпты

Следующие промпты можно добавлять как комментарии к любой задаче или pull request на GitHub для управления поведением AI-решателя.

### Промпт глубокого анализа ошибки

Используйте, когда ошибка требует тщательного изучения перед попыткой исправления:

```
Please perform a deep case study for this issue:
1. Download all relevant logs, error output, and reproduction data to ./docs/case-studies/issue-{id}/
2. Search online for similar issues, known root causes, and community solutions
3. Reconstruct the full timeline: when did this start, what changed, what is the sequence of events that causes the bug?
4. Identify the true root cause (not just the symptom)
5. Propose multiple solution approaches with trade-offs
6. Implement the best solution with tests
7. Verify CI/CD checks pass before finalizing
```

### Промпт глубокого анализа функциональности

Используйте, когда запрос функциональности требует исследования и дизайна перед реализацией:

```
Please perform a deep analysis for this feature request:
1. Collect all relevant context and examples to ./docs/case-studies/issue-{id}/
2. Search online for how similar features are implemented in comparable tools
3. Analyze trade-offs: performance, maintainability, backward compatibility
4. Propose a detailed implementation plan with alternative approaches
5. Implement the chosen approach with tests
6. Update documentation to reflect the new feature
7. Verify all CI/CD checks pass before finalizing
```

### Универсальный промпт валидации

Добавьте как комментарий перед финализацией любого решения, чтобы ничего не упустить:

```
Before marking this complete, please verify:
1. All requirements from the original issue are addressed
2. All discussion points from PR/issue comments are resolved
3. All CI/CD checks are passing (no lint errors, all tests green)
4. No previously working features have been broken
5. Code follows the repository's existing style and conventions
6. Documentation is updated if behavior changed
7. No debug code, temporary hacks, or TODOs remain
8. The changeset (if required) is present and accurate
```

### Промпт режима планирования

Используйте, когда хотите, чтобы AI предложил план перед написанием кода:

```
Please enter plan mode for this issue:
1. Collect all relevant data to ./docs/case-studies/issue-{id}/
2. Read all related source files, tests, and documentation
3. Search online if external knowledge is needed
4. Propose a detailed step-by-step implementation plan
5. List all files that will be created or modified
6. Identify risks and edge cases
7. Wait for approval before writing any code
```

### Промпт максимальной мощности

Используйте для сложных задач, где требуются все возможности AI:

```
Solve this issue using maximum thoroughness:
- Use --model opus --think max for deep reasoning
- Download and analyze all relevant logs
- Do online research for similar problems and solutions
- Write comprehensive tests covering edge cases
- Add detailed tracing/logging that remains in code but is off by default
- Ensure all CI/CD checks pass
- Leave no stone unturned
```

## Написание хороших задач

Хорошие требования к задачам — это основа качественных AI-решений. Изучайте закрытые задачи и слитые PR в этом репозитории для примеров.

### Чеклист для написания задач

- [ ] **Чёткое описание проблемы** — Что сломано или отсутствует? Какое ожидаемое и фактическое поведение?
- [ ] **Шаги воспроизведения** — Как надёжно воспроизвести проблему?
- [ ] **Контекст** — Какие файлы, функции или компоненты задействованы? Дайте ссылки на них.
- [ ] **Критерии приёмки** — Какие конкретные условия определяют «сделано»? Перечислите их явно.
- [ ] **Примеры** — Включите фрагменты кода, сообщения об ошибках или скриншоты в качестве доказательств.
- [ ] **Ограничения** — Есть ли вещи, которые решение НЕ должно делать (например, не должно сломать X, не должно добавлять зависимость)?
- [ ] **Приоритет** — Насколько срочно это? Какой будет эффект если оставить неисправленным?

### Паттерны требований к задачам из этого репозитория

На основе успешно решённых задач в этом репозитории:

**Для ошибок:**

```
## Problem
[One sentence description of the wrong behavior]

## Steps to Reproduce
1. [Exact command or action]
2. [What happens]
3. [What should happen instead]

## Root Cause Hypothesis
[Optional: your best guess at why this happens]

## Acceptance Criteria
- [ ] [Specific measurable condition 1]
- [ ] [Specific measurable condition 2]
- [ ] All CI/CD checks pass
```

**Для функциональностей:**

```
## Goal
[One sentence description of the new capability]

## Motivation
[Why is this needed? What problem does it solve?]

## Proposed Implementation
[Optional: your suggestion for how to implement it]

## Acceptance Criteria
- [ ] [Feature works in scenario A]
- [ ] [Feature works in scenario B]
- [ ] Tests cover the new behavior
- [ ] Documentation is updated
- [ ] All CI/CD checks pass
```

## Улучшение архитектуры

Для улучшения архитектуры кодовой базы с помощью AI используйте этот промпт, ссылающийся на принципы архитектуры кода:

```
Please analyze this codebase against the architecture principles at:
https://raw.githubusercontent.com/link-foundation/code-architecture-principles/refs/heads/main/README.md

For each principle that is currently violated or could be better applied:
1. Identify the specific location (file:line) where the violation occurs
2. Explain why it is a violation and what the impact is
3. Propose a concrete refactoring with a before/after code example
4. Prioritize by impact: high/medium/low

Focus especially on:
- File size limits (1000-1500 lines max)
- Single Responsibility principle
- Separation of concerns
- Testability
- Explicit interfaces and minimal coupling
```

### Краткое изложение ключевых архитектурных принципов

Для более глубокого руководства по написанию поддерживаемого кода смотрите [Принципы архитектуры кода](https://github.com/link-foundation/code-architecture-principles), которые охватывают:

**Универсальные принципы:**

- **Модульность**: Разделяйте системы на небольшие, тестируемые части
- **Разделение ответственности**: Высокая связность, низкая зависимость
- **Абстракция**: Скрывайте детали реализации за стабильными интерфейсами
- **Неизменяемость**: Предпочитайте создание новых значений вместо мутации
- **Отказывать быстро**: Проверяйте входные данные на границах системы

**Ключевые рекомендации:**

1. Проектируйте API, которые очевидно правильно использовать и трудно использовать неправильно
2. Открывайте функциональность для расширяемости, а не прячьте внутренности
3. Делайте невалидные состояния невозможными через продуманное моделирование данных
4. Переносите побочные эффекты на края системы; сохраняйте чистоту основной логики
5. Используйте системы типов для моделирования допустимых форм данных
6. Пишите небольшие, сфокусированные функции, делающие одно хорошо
7. Предпочитайте композицию наследованию и сложности

## Лучшие практики CI/CD

CI/CD-пайплайны — основа качества AI-driven разработки. Когда проверки применяются:

- AI-решатели **вынуждены итерировать** пока все тесты не пройдут
- Качество кода **гарантировано** независимо от того, человек или AI его написал
- Проблемы выявляются **рано** до попадания в production

Смотрите **[CI-CD-BEST-PRACTICES.md](./CI-CD-BEST-PRACTICES.md)** для полного руководства, включая:

- Запуск проверок только при изменениях релевантных файлов (экономия затрат CI)
- Ограничения размера файлов и порядок заданий с ранним отказом
- Автоматизированное форматирование, линтинг и статический анализ
- Версионирование на основе Changeset без конфликтов слияния
- Симуляция свежего слияния для проверки фактического результата слияния
- Доверенная публикация OIDC без долгосрочных секретов

Готовые к использованию шаблоны доступны для JavaScript, Rust, Python, Go, C# и Java.

## Использование субагентов

Hive Mind может координировать несколько AI-агентов, работающих параллельно. Используйте субагентов для:

### Когда использовать субагентов

- **Независимые параллельные исследования** — Один агент ищет логи, пока другой читает исходный код
- **Защита основного контекста** — Передавайте большие чтения файлов или длинные поиски субагентам
- **Специализированные задачи** — Используйте выделенного агента для документации, другого для тестов
- **Перекрёстная проверка** — Пусть несколько агентов предлагают решения независимо, затем сравните

### Паттерны субагентов

**Параллельные исследования:**

```
Launch subagents concurrently for:
- Agent 1: Read all source files related to [feature area]
- Agent 2: Search for recent issues and PRs related to this problem
- Agent 3: Read all test files to understand expected behavior
Then synthesize findings before implementing.
```

**Поэтапная работа:**

```
Stage 1 (research subagent): Collect and analyze all relevant data
Stage 2 (plan subagent): Design the implementation approach
Stage 3 (implementation): Write and test the solution
Stage 4 (validation subagent): Run all checks and verify requirements
```

**Итерация по чеклисту:**

```
Maintain a checklist of all requirements from the issue.
After each step, check off completed items.
Iterate until the checklist is fully complete and all CI/CD checks pass.
Never mark a task done until it is verified working.
```

## Ссылки

- [Принципы архитектуры кода](https://github.com/link-foundation/code-architecture-principles)
- [Лучшие практики CI/CD](./CI-CD-BEST-PRACTICES.md)
- [Руководство по участию в разработке](./CONTRIBUTING.ru.md)
- [Параметры конфигурации](./CONFIGURATION.md)
