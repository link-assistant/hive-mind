# Лучшие практики CI/CD для разработки с использованием AI (languages: [en](CI-CD-BEST-PRACTICES.md) • [zh](CI-CD-BEST-PRACTICES.zh.md) • [hi](CI-CD-BEST-PRACTICES.hi.md) • ru)

Этот документ описывает лучшие практики CI/CD, которые существенно повышают качество и надёжность рабочих процессов разработки с использованием AI. При правильной настройке AI-решатели Hive Mind вынуждены итерировать с проверками CI/CD до тех пор, пока все тесты не пройдут успешно, гарантируя соответствие кода высочайшим стандартам качества.

## Почему CI/CD важен для разработки с AI

AI-решатель задач Hive Mind инструктирован обращать внимание на проверки CI/CD в каждом pull request. Это создаёт мощную обратную связь:

1. **AI создаёт решение** — решатель генерирует код на основе требований задачи
2. **CI/CD проверяет решение** — автоматические проверки верифицируют качество кода
3. **AI итерирует до прохождения** — решатель исправляет проблемы до тех пор, пока все проверки не пройдут
4. **Качество гарантировано** — ни один код не вливается без прохождения всех шлюзов

Такой подход обеспечивает стабильное качество вне зависимости от того, состоит ли команда из людей, AI-систем или тех и других.

## Рекомендуемые шаблоны CI/CD

Мы предоставляем готовые к использованию шаблоны для нескольких языков со всеми предварительно настроенными лучшими практиками:

| Язык                  | Репозиторий шаблона                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript/TypeScript | [js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template)         |
| Rust                  | [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)     |
| Python                | [python-ai-driven-development-pipeline-template](https://github.com/link-foundation/python-ai-driven-development-pipeline-template) |
| Go                    | [go-ai-driven-development-pipeline-template](https://github.com/link-foundation/go-ai-driven-development-pipeline-template)         |
| C#                    | [csharp-ai-driven-development-pipeline-template](https://github.com/link-foundation/csharp-ai-driven-development-pipeline-template) |
| Java                  | [java-ai-driven-development-pipeline-template](https://github.com/link-foundation/java-ai-driven-development-pipeline-template)     |
| PHP                   | [php-ai-driven-development-pipeline-template](https://github.com/link-foundation/php-ai-driven-development-pipeline-template)       |

> **Совет:** вам не нужно выбирать шаблон вручную. Запустите `fix <repository-url> --ci-cd` (см. раздел [Автоматическое исправление CI/CD](#автоматическое-исправление-cicd)), и Hive Mind определит языки репозитория и подберёт для вас подходящие шаблоны.

## Ключевые принципы CI/CD

### 1. Запускать проверки только при изменениях релевантных файлов

**Запускайте проверки только при изменении релевантных файлов.** Это существенно снижает расходы на CI и время выполнения.

Используйте задание `detect-changes` в начале рабочего процесса для определения изменённых категорий файлов:

```yaml
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      code-changed: ${{ steps.changes.outputs.code }}
      docs-changed: ${{ steps.changes.outputs.docs }}
      docker-changed: ${{ steps.changes.outputs.docker }}
      workflow-changed: ${{ steps.changes.outputs.workflow }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - name: Detect changes
        id: changes
        run: node scripts/detect-code-changes.mjs
```

Затем добавьте зависимость каждого задания от соответствующего вывода:

```yaml
test-suites:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.code-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
  # ...

validate-docs:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  # ...

docker-pr-check:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docker-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
  # ...
```

**Что исключить из обнаружения "изменений кода":**

- Markdown-файлы (`*.md`) — изменения только документации не требуют файлов changeset
- Папка `.changeset/` — метаданные changeset не являются кодом
- Папки `data/` и `experiments/` — непродакшн-контент
- Файлы `.gitkeep` — файлы-заглушки без функционального воздействия

**Что всегда запускает проверки при изменении:**

- Файлы исходного кода (`.mjs`, `.ts`, `.py`, `.rs`, `.go` и т.д.)
- `package.json` / манифесты зависимостей
- Файлы рабочих процессов CI/CD (`.github/workflows/*.yml`)
- `Dockerfile` и связанные файлы инфраструктуры

### 2. Ограничение размера файлов

**Устанавливайте максимум в 1000–1500 строк на файл кода.**

Это ограничение приносит пользу как AI-разработчикам, так и людям:

- AI-модели могут читать и понимать целые файлы в пределах контекстных окон
- Люди могут навигировать по файлам и понимать их без когнитивной перегрузки
- Стимулирует модульную, хорошо организованную архитектуру кода

Пример проверки в CI (bash):

```bash
find src/ -name "*.mjs" -type f | while read -r file; do
  line_count=$(wc -l < "$file")
  if [ "$line_count" -gt 1500 ]; then
    echo "ERROR: $file has $line_count lines (limit: 1500)"
    echo "::error file=$file::File has $line_count lines (limit: 1500)"
    exit 1
  fi
done
```

**Синхронизируйте правило ESLint для размера файла с проверкой CI**, чтобы выявлять нарушения локально до CI:

```js
// eslint.config.mjs
{
  rules: {
    'max-lines': ['error', { max: 1500 }]
  }
}
```

### 3. Автоматическое форматирование кода

Единообразное форматирование устраняет споры о стиле и снижает шум в diff:

| Язык                  | Инструмент                    |
| --------------------- | ----------------------------- |
| JavaScript/TypeScript | ESLint + Prettier             |
| Rust                  | rustfmt                       |
| Python                | Ruff                          |
| Go                    | gofmt                         |
| C#                    | dotnet format                 |
| Java                  | Spotless (Google Java Format) |
| PHP                   | PHP CS Fixer                  |

Все шаблоны включают pre-commit хуки, автоматически запускающие форматтеры перед каждым коммитом.

### 4. Статический анализ и линтинг

Выявляйте ошибки и применяйте паттерны до прохождения кода через ревью:

| Язык                  | Инструменты                                |
| --------------------- | ------------------------------------------ |
| JavaScript/TypeScript | ESLint со строгими правилами               |
| Rust                  | Clippy (pedantic + nursery)                |
| Python                | Ruff + mypy                                |
| Go                    | go vet + staticcheck                       |
| C#                    | .NET analyzers (предупреждения как ошибки) |
| Java                  | SpotBugs (максимальные усилия)             |
| PHP                   | PHPStan (max level)                        |

### 5. Порядок быстрого обнаружения ошибок

**Запускайте быстрые проверки перед медленными** для получения обратной связи как можно быстрее:

```
Быстрые проверки (~7-30 сек каждая):   Медленные проверки (~1-10 мин каждая):
├── test-compilation                     ├── test-suites (модульные тесты)
├── lint (format + ESLint)               ├── test-execution (интеграционные)
└── check-file-line-limits               ├── docker-pr-check
                                         └── helm-pr-check
```

Поставьте медленные проверки в зависимость от быстрых:

```yaml
test-suites:
  needs: [test-compilation, lint, check-file-line-limits]
  if: |
    always() &&
    !cancelled() &&
    !contains(needs.*.result, 'failure') &&
    needs.test-compilation.result == 'success' &&
    needs.lint.result == 'success' &&
    needs.check-file-line-limits.result == 'success'
```

### 6. Управление версиями на основе changeset

Все шаблоны используют систему changeset, которая:

- **Устраняет конфликты слияния** — каждый PR создаёт независимый файл changeset
- **Автоматизирует обновления версий** — при слиянии побеждает наивысший тип обновления
- **Генерирует журналы изменений** — заметки о релизе компилируются автоматически
- **Поддерживает семантическое версионирование** — обновления patch/minor/major явно указаны

| Язык                  | Инструмент                           |
| --------------------- | ------------------------------------ |
| JavaScript/TypeScript | @changesets/cli                      |
| Rust                  | changelog.d + кастомные скрипты      |
| Python                | Scriv                                |
| PHP                   | changelog.d + кастомные скрипты      |
| Go, C#, Java          | Кастомные рабочие процессы changeset |

**Освобождайте PR только с документацией от требования changeset:**

```yaml
changeset-check:
  needs: [detect-changes]
  if: github.event_name == 'pull_request' && needs.detect-changes.outputs.any-code-changed == 'true'
```

Изменения только в документации (обновление `.md`-файлов) не должны требовать обновления версии.

### 7. Проверять фактический результат слияния

**CI должен тестировать то, что фактически будет слито, а не устаревший снимок PR.**

Когда PR открыт против базовой ветки, которая впоследствии получает новые коммиты, предварительный просмотр слияния GitHub может устареть. Имитируйте свежее слияние перед запуском проверок:

```yaml
- name: Simulate fresh merge with base branch (PR only)
  if: github.event_name == 'pull_request'
  env:
    BASE_REF: ${{ github.base_ref }}
  run: |
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git config user.name "github-actions[bot]"
    git fetch origin "$BASE_REF"
    BEHIND_COUNT=$(git rev-list --count HEAD..origin/$BASE_REF)
    if [ "$BEHIND_COUNT" -gt 0 ]; then
      git merge origin/$BASE_REF --no-edit || \
        (echo "::error::Merge conflict! PR must be rebased before merging." && exit 1)
    fi
```

Это гарантирует, что проверки линтинга, размера файлов и другие проверяют финальное состояние после слияния.

### 8. Pre-commit хуки

Локальные шлюзы качества предотвращают попадание некорректных коммитов в CI:

1. Проверка формата и автоисправление
2. Линтинг и статический анализ
3. Проверка типов (где применимо)
4. Проверка размера файла
5. Обнаружение секретов

Такой подход "смещения влево" выявляет проблемы немедленно, не дожидаясь CI.

### 9. Автоматизация релизов

Автоматизированные рабочие процессы релизов обеспечивают:

- **Отсутствие ручного управления версиями** — версии обновляются автоматически
- **Доверенная публикация OIDC** — не требуются API-токены в CI (npm, PyPI, crates.io)
- **Только проверенные релизы** — все проверки должны пройти перед публикацией
- **Два режима запуска** — автоматический (при слиянии) и ручной (workflow dispatch)

**Запрещайте ручные изменения версий** в PR — все обновления версий должны управляться рабочим процессом релиза CI:

```yaml
version-check:
  if: github.event_name == 'pull_request'
  steps:
    - name: Check for version changes in package.json
      run: node scripts/check-version.mjs
```

### 10. Управление конкурентностью

**Предотвращайте конфликты нескольких запусков рабочего процесса:**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  # Отменять старые запуски на main для всегда актуального релиза последней версии
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

Используйте `!cancelled()` вместо `always()` в условиях заданий, чтобы отмена корректно распространялась по графу заданий.

### 11. Обнаружение секретов

Предотвращайте случайные утечки учётных данных в CI:

- Включите шаг сканирования секретов с использованием таких инструментов, как `secretlint` или `truffleHog`
- Немедленно останавливайте CI при обнаружении секретов
- Никогда не записывайте в журнал переменные окружения или значения токенов

### 12. Валидация документации

**Проверяйте файлы документации в CI так же, как код:**

- Проверяйте ограничения размера файла (например, максимум 2500 строк для документов)
- Проверяйте наличие обязательных разделов в ключевых документах
- Проверяйте битые ссылки с помощью таких инструментов, как `lychee`

```yaml
validate-docs:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  steps:
    - run: node tests/docs-validation.mjs
```

## Стратегия обеспечения качества

Шаблоны реализуют многоуровневый подход к защите:

```
Машина разработчика  →    Конвейер CI/CD      →    Релиз
├── Pre-commit хуки       ├── detect-changes       ├── Все проверки пройдены
├── Локальные тесты       ├── version-check        ├── Обновление версии
└── Интеграция с IDE      ├── changeset-check      ├── Обновление журнала изменений
                          ├── test-compilation     └── Публикация пакета
                          ├── lint (format+ESLint)
                          ├── check-file-line-limits
                          ├── test-suites
                          ├── test-execution
                          ├── validate-docs
                          └── docker-pr-check
```

Каждый уровень выявляет разные проблемы, гарантируя, что некорректный код не попадёт в продакшн.

## Начало работы

1. **Выберите шаблон** из таблицы выше, соответствующий вашему языку
2. **Используйте его как шаблон GitHub** для создания нового репозитория
3. **Настройте секреты** при необходимости для публикации (предпочтительно OIDC)
4. **Начинайте разработку** со всеми предварительно настроенными лучшими практиками

AI-решатели автоматически будут учитывать и итерировать со всеми настроенными проверками, производя более качественный результат по сравнению с репозиториями без принуждения CI/CD.

## Автоматическое исправление CI/CD

Для существующего репозитория вам не нужно применять эти практики вручную. Команда `fix` автоматизирует весь процесс:

```bash
fix https://github.com/owner/repo --ci-cd
```

Эта команда:

1. **Определяет языки репозитория** с помощью API GitHub Linguist (`GET /repos/{owner}/{repo}/languages`), упорядочивая их по количеству байт на язык.
2. **Подбирает подходящие шаблоны CI/CD** из таблицы выше, сортируя так, чтобы шаблон для наиболее используемого языка шёл первым.
3. **Проверяет последний коммит ветки по умолчанию** и собирает его запуски CI/CD (возвращаясь к самым свежим запускам в ветке по умолчанию, если у последнего коммита их нет).
4. **Создаёт задачу на исправление**, в которой перечисляются неуспешные запуски, обнаруженные языки, рекомендуемые шаблоны и ссылка на этот документ.
5. **Передаёт задачу команде `/solve --auto-merge`**, которая итерирует до тех пор, пока исправления не будут слиты. Каждая опция, которую сама команда `fix` не использует (например, `--tool`, `--model`, `--think`), передаётся в `/solve`.

### Сопоставление язык → шаблон

Команда сопоставляет обнаруженные языки с шаблонами следующим образом (JavaScript и TypeScript используют один общий шаблон):

| Обнаруженный язык(и)  | Шаблон                                                           |
| --------------------- | ---------------------------------------------------------------- |
| JavaScript/TypeScript | `link-foundation/js-ai-driven-development-pipeline-template`     |
| Rust                  | `link-foundation/rust-ai-driven-development-pipeline-template`   |
| Python                | `link-foundation/python-ai-driven-development-pipeline-template` |
| Go                    | `link-foundation/go-ai-driven-development-pipeline-template`     |
| C#                    | `link-foundation/csharp-ai-driven-development-pipeline-template` |
| Java                  | `link-foundation/java-ai-driven-development-pipeline-template`   |
| PHP                   | `link-foundation/php-ai-driven-development-pipeline-template`    |

Языки без выделенного шаблона (например, Shell или Dockerfile) перечисляются в задаче для сведения, и для них рекомендуется наиболее близкий по соответствию шаблон.

Используйте `--dry-run` для предварительного просмотра задачи без её создания и `--no-solve` для создания задачи без запуска `/solve`:

```bash
fix owner/repo --ci-cd --dry-run
fix owner/repo --ci-cd --no-solve
```

## Ссылки

- [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles)
- [Contributing Guidelines](./CONTRIBUTING.md)
- [Best Practices](./BEST-PRACTICES.md)
