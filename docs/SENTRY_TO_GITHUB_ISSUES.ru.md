# Преобразование задач Sentry в задачи GitHub: Всесторонний анализ (languages: [en](SENTRY_TO_GITHUB_ISSUES.md) • [zh](SENTRY_TO_GITHUB_ISSUES.zh.md) • [hi](SENTRY_TO_GITHUB_ISSUES.hi.md) • ru)

## Обзор

Этот документ рассматривает все доступные варианты преобразования задач Sentry в задачи GitHub для проекта Hive Mind. Наш экземпляр Sentry расположен по адресу https://deepassistant.sentry.io/issues.

## Варианты решения

### 1. Нативная интеграция Sentry с GitHub ⭐ Рекомендуется для быстрой настройки

#### Обзор

Sentry предоставляет встроенную интеграцию с GitHub, позволяющую создавать задачи GitHub и связывать их напрямую из Sentry.

#### Возможности

**Ручное создание задач:**

- Перейдите к любой задаче Sentry
- Используйте раздел «Linked Issues» на правой панели
- Нажмите для создания новой задачи GitHub
- Автоматически предлагает исполнителей на основе файла CODEOWNERS
- Создаёт двунаправленную связь между Sentry и GitHub

**Автоматическое создание задач:**

- Настройте оповещения о задачах в Sentry
- Добавьте действие «Create a new GitHub issue» в правила оповещений
- Задачи GitHub создаются автоматически при срабатывании оповещений
- Доступно только для планов Business или Enterprise

#### Шаги настройки

1. Перейдите в Sentry Settings > Integrations
2. Выберите интеграцию GitHub
3. Установите приложение Sentry GitHub App
4. Подключите репозитории GitHub
5. (Необязательно) Загрузите файл CODEOWNERS для автоматического назначения
6. Настройте оповещения о задачах для автоматического создания

#### Преимущества

- ✅ Официальная интеграция, поддерживаемая Sentry
- ✅ Не требует написания кода
- ✅ Двунаправленная связь (Sentry ↔ GitHub)
- ✅ Автоматическое назначение на основе CODEOWNERS
- ✅ Работает с комментариями к PR и релизами
- ✅ Быстрая настройка (5–10 минут)

#### Недостатки

- ❌ Автоматическое создание требует плана Business/Enterprise
- ❌ Ограниченная кастомизация формата задачи
- ❌ Требуются ручные действия для бесплатного плана
- ❌ Невозможно массово конвертировать существующие задачи

#### Стоимость

- Ручное создание: доступно на всех планах (Team, Business, Enterprise)
- Автоматическое создание: только планы Business/Enterprise

#### Документация

- https://docs.sentry.io/organization/integrations/source-code-mgmt/github/
- https://sentry.io/integrations/github/

---

### 2. Кастомная реализация с Sentry API + GitHub API ⭐ Рекомендуется для полного контроля

#### Обзор

Создайте кастомный скрипт или сервис, использующий REST API Sentry для получения задач и Octokit от GitHub для программного создания задач.

#### Архитектура

```
Sentry API → Custom Script → GitHub API
    ↓              ↓              ↓
Fetch Issues   Transform     Create Issues
```

#### Пример реализации

**Зависимости:**

```bash
npm install @sentry/node octokit
```

**Пример кода:**

```javascript
import { Octokit } from 'octokit';

const SENTRY_API_TOKEN = process.env.SENTRY_API_TOKEN;
const SENTRY_ORG = 'link-assistant';
const SENTRY_PROJECT = 'hive-mind';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'link-assistant';
const GITHUB_REPO = 'hive-mind';

const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function fetchSentryIssues() {
  const response = await fetch(`https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved`, {
    headers: {
      Authorization: `Bearer ${SENTRY_API_TOKEN}`,
    },
  });
  return response.json();
}

async function createGitHubIssue(sentryIssue) {
  const { data } = await octokit.rest.issues.create({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    title: `[Sentry] ${sentryIssue.title}`,
    body: `
## Sentry Issue

**Issue URL:** ${sentryIssue.permalink}
**Status:** ${sentryIssue.status}
**First Seen:** ${sentryIssue.firstSeen}
**Last Seen:** ${sentryIssue.lastSeen}
**Count:** ${sentryIssue.count} events
**User Count:** ${sentryIssue.userCount} users affected

## Error Details

${sentryIssue.metadata?.type || 'N/A'}: ${sentryIssue.metadata?.value || 'N/A'}

---
*Automatically created from Sentry*
    `.trim(),
    labels: ['bug', 'sentry', 'automated'],
  });
  return data;
}

async function main() {
  const sentryIssues = await fetchSentryIssues();

  for (const issue of sentryIssues) {
    try {
      const githubIssue = await createGitHubIssue(issue);
      console.log(`Created GitHub issue #${githubIssue.number} for Sentry issue ${issue.id}`);
    } catch (error) {
      console.error(`Failed to create issue for ${issue.id}:`, error);
    }
  }
}

main();
```

#### Шаги настройки

1. Создайте токен аутентификации Sentry (Settings > Account > API > Auth Tokens)
2. Создайте персональный токен доступа GitHub с областью `repo`
3. Установите зависимости: `npm install octokit`
4. Создайте скрипт с аутентификацией
5. Запускайте вручную или по расписанию с помощью cron/GitHub Actions

#### Детали Sentry API

**Конечная точка:** `GET /api/0/projects/{org_slug}/{project_slug}/issues/`

**Аутентификация:** Bearer-токен в заголовке Authorization

**Ключевые параметры:**

- `query`: Фильтр задач (например, `is:unresolved`, `is:unresolved is:for_review`)
- `statsPeriod`: Временной диапазон (`24h`, `14d`)
- `cursor`: Пагинация

**Ответ включает:**

- ID задачи, заголовок, статус
- Временные метки первого и последнего появления
- Количество событий, количество пользователей
- Метаданные (тип ошибки, значение)
- Постоянная ссылка на интерфейс Sentry

#### Детали GitHub API

**Конечная точка:** `POST /repos/{owner}/{repo}/issues`

**Аутентификация:** Персональный токен доступа

**Параметры:**

- `title`: Заголовок задачи (обязательный)
- `body`: Описание задачи (необязательный)
- `labels`: Массив имён меток
- `assignees`: Массив имён пользователей GitHub
- `milestone`: Номер milestone

#### Преимущества

- ✅ Полный контроль над форматом и содержимым задачи
- ✅ Возможность массовой конвертации существующих задач
- ✅ Настраиваемая фильтрация и преобразование
- ✅ Возможность добавления кастомных меток, исполнителей, milestone
- ✅ Работает с бесплатным планом Sentry
- ✅ Может быть запущен по расписанию или по событию
- ✅ @sentry/node уже установлен

#### Недостатки

- ❌ Требует разработки и поддержки
- ❌ Необходима обработка ограничений частоты запросов
- ❌ Необходимо отслеживать уже конвертированные задачи
- ❌ Двунаправленная синхронизация отсутствует из коробки

#### Стоимость

- Бесплатно (использует Sentry API + GitHub API)

#### Документация

- Sentry API: https://docs.sentry.io/api/events/list-a-projects-issues/
- GitHub Octokit: https://github.com/octokit/octokit.js
- GitHub Issues API: https://docs.github.com/en/rest/issues/issues

---

### 3. Webhooks Sentry + кастомный сервис ⭐ Рекомендуется для работы в реальном времени

#### Обзор

Используйте интеграцию Sentry с webhook для получения уведомлений в реальном времени при создании или обновлении задач, а затем автоматически создавайте задачи GitHub.

#### Архитектура

```
Sentry Issue Created/Updated
         ↓
   Sentry Webhook
         ↓
   Your Web Service (Express.js)
         ↓
   GitHub API (Create Issue)
```

#### Пример реализации

**Зависимости:**

```bash
npm install express octokit
```

**Пример кода:**

```javascript
import express from 'express';
import { Octokit } from 'octokit';

const app = express();
app.use(express.json());

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

app.post('/sentry-webhook', async (req, res) => {
  const resource = req.headers['sentry-hook-resource'];
  const action = req.body.action;

  if (resource === 'issue' && action === 'created') {
    const sentryIssue = req.body.data.issue;

    await octokit.rest.issues.create({
      owner: 'link-assistant',
      repo: 'hive-mind',
      title: `[Sentry] ${sentryIssue.title}`,
      body: `
Sentry Issue: ${sentryIssue.web_url}
Status: ${sentryIssue.status}

${sentryIssue.metadata?.type}: ${sentryIssue.metadata?.value}
      `.trim(),
      labels: ['bug', 'sentry', 'automated'],
    });
  }

  res.status(200).send('OK');
});

app.listen(3000);
```

#### Полезная нагрузка webhook

**Заголовок:** `Sentry-Hook-Resource: issue`

**Действия:** `created`, `resolved`, `assigned`, `archived`, `unresolved`

**Полезная нагрузка включает:**

- URL задачи, URL проекта
- Статус и подстатус
- Детали статуса (информация об устранении)
- Полные метаданные задачи

#### Шаги настройки

1. Создайте внутреннюю интеграцию в Sentry (Settings > Custom Integrations)
2. Настройте URL webhook (ваша публичная конечная точка)
3. Подпишитесь на события «Issue»
4. Разверните сервис-получатель webhook
5. Протестируйте с образцами задач

#### Преимущества

- ✅ Создание задач в реальном времени (мгновенно)
- ✅ Управляемый событиями, опрос не нужен
- ✅ Возможность реагировать на изменения статуса (resolved, reopened)
- ✅ Низкое потребление ресурсов
- ✅ Масштабируемая архитектура

#### Недостатки

- ❌ Требует размещения веб-сервиса
- ❌ Необходима публичная HTTPS-конечная точка
- ❌ Более сложная настройка
- ❌ Необходима обработка повторных попыток webhook и сбоев

#### Стоимость

- Бесплатно (webhook Sentry + GitHub API)
- Стоимость хостинга для сервиса webhook (варьируется)

#### Документация

- https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/

---

### 4. Сторонние платформы автоматизации

#### 4.1 Pipedream ⭐ Самый простой вариант без кода

**Обзор:** Low-code платформа с готовыми рабочими процессами Sentry → GitHub

**Возможности:**

- Готовые шаблоны рабочих процессов
- «Create GitHub Issue on New Sentry Issue Event»
- Визуальный конструктор рабочих процессов
- Встроенная аутентификация для обоих сервисов
- Выполнение без сервера

**Настройка:**

1. Зарегистрируйтесь на https://pipedream.com
2. Выберите триггер «Sentry API»: «New Issue Event (Instant)»
3. Добавьте действие «GitHub API»: «Create Issue»
4. Сопоставьте поля Sentry с полями GitHub
5. Разверните рабочий процесс

**Преимущества:**

- ✅ Не требует написания кода
- ✅ Доступны готовые шаблоны
- ✅ Визуальный конструктор рабочих процессов
- ✅ Доступен бесплатный уровень (100 вызовов/день)
- ✅ Хостинг включён

**Недостатки:**

- ❌ Ограниченная кастомизация на бесплатном уровне
- ❌ Привязка к поставщику
- ❌ Ограничения использования на бесплатном плане

**Стоимость:** Бесплатный уровень (100 вызовов/день), платный ($19/мес+)

**URL:** https://pipedream.com/apps/sentry/integrations/github

---

#### 4.2 n8n — самостоятельно размещаемая альтернатива

**Обзор:** Автоматизация рабочих процессов с открытым исходным кодом, самостоятельный хостинг

**Возможности:**

- Визуальный конструктор рабочих процессов
- Доступны узлы Sentry + GitHub
- Самостоятельный хостинг (полный контроль)
- Может работать на вашей инфраструктуре

**Настройка:**

1. Разверните n8n (Docker/npm)
2. Создайте рабочий процесс с триггером Sentry
3. Добавьте узел GitHub «Create Issue»
4. Настройте сопоставление полей
5. Активируйте рабочий процесс

**Преимущества:**

- ✅ Открытый исходный код и бесплатно
- ✅ Самостоятельный хостинг (данные остаются у вас)
- ✅ Неограниченное количество выполнений
- ✅ Полная кастомизация
- ✅ Соответствие SOC2

**Недостатки:**

- ❌ Требует хостинга/инфраструктуры
- ❌ Более сложная настройка
- ❌ Самостоятельное обслуживание

**Стоимость:** Бесплатно (самостоятельный хостинг) или Cloud ($20/мес+)

**URL:** https://n8n.io/integrations/github/and/sentryio/

---

#### 4.3 Make.com (ранее Integromat)

**Обзор:** Визуальная платформа автоматизации с поддержкой Sentry и GitHub

**Возможности:**

- Визуальный конструктор сценариев
- Модуль Sentry: получение задач
- Модуль GitHub: создание задач, PR, комментариев
- Расширенная маршрутизация и фильтрация

**Настройка:**

1. Зарегистрируйтесь на https://www.make.com
2. Создайте новый сценарий
3. Добавьте модуль Sentry (триггер или действие)
4. Добавьте модуль GitHub «Create Issue»
5. Сопоставьте поля данных
6. Запустите сценарий

**Преимущества:**

- ✅ Визуальный конструктор без кода
- ✅ Расширенные функции (маршрутизация, фильтрация)
- ✅ Бесплатный уровень (1 000 операций/мес)
- ✅ Хорошая документация

**Недостатки:**

- ❌ Более крутая кривая обучения
- ❌ Сложная модель ценообразования
- ❌ Ограниченное количество операций на бесплатном уровне

**Стоимость:** Бесплатный уровень (1 000 операций/мес), платный ($9/мес+)

**URLs:**

- Sentry: https://www.make.com/en/integrations/sentry
- GitHub: https://www.make.com/en/integrations/github

---

#### 4.4 Zapier — наибольшее количество интеграций

**Обзор:** Лидер рынка автоматизации с более чем 7 000 приложений

**Возможности:**

- Простой конструктор рабочих процессов (Zaps)
- Доступна интеграция Sentry
- Доступна интеграция GitHub
- Лучше всего подходит для бизнес-пользователей

**Настройка:**

1. Зарегистрируйтесь на https://zapier.com
2. Создайте новый Zap
3. Триггер: Sentry (требует настройки webhook)
4. Действие: GitHub «Create Issue»
5. Сопоставьте поля и включите

**Преимущества:**

- ✅ Наиболее простой для нетехнических пользователей
- ✅ Наиболее зрелая платформа
- ✅ Обширная экосистема приложений
- ✅ Отличная поддержка и документация

**Недостатки:**

- ❌ Более дорогой
- ❌ Ограниченная интеграция с Sentry
- ❌ Бесплатный уровень очень ограничен (100 задач/мес)

**Стоимость:** Бесплатный уровень (100 задач/мес), платный ($19.99/мес+)

---

### 5. Кастомный рабочий процесс GitHub Actions

#### Обзор

Создайте запланированное действие GitHub, которое опрашивает Sentry API и создаёт задачи

#### Пример реализации

**.github/workflows/sentry-sync.yml:**

```yaml
name: Sync Sentry Issues to GitHub

on:
  schedule:
    - cron: '0 */6 * * *' # Every 6 hours
  workflow_dispatch: # Manual trigger

jobs:
  sync-issues:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install octokit

      - name: Sync Sentry Issues
        env:
          SENTRY_API_TOKEN: ${{ secrets.SENTRY_API_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/sync-sentry-issues.js
```

**scripts/sync-sentry-issues.js:**

```javascript
import { Octokit } from 'octokit';
import fs from 'fs';

const SYNCED_ISSUES_FILE = 'synced-sentry-issues.json';

async function main() {
  const synced = fs.existsSync(SYNCED_ISSUES_FILE) ? JSON.parse(fs.readFileSync(SYNCED_ISSUES_FILE)) : {};

  const sentryIssues = await fetchSentryIssues();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  for (const issue of sentryIssues) {
    if (synced[issue.id]) continue;

    const ghIssue = await octokit.rest.issues.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: `[Sentry] ${issue.title}`,
      body: createIssueBody(issue),
      labels: ['bug', 'sentry'],
    });

    synced[issue.id] = ghIssue.data.number;
    fs.writeFileSync(SYNCED_ISSUES_FILE, JSON.stringify(synced));
  }
}

main();
```

#### Преимущества

- ✅ Выполняется автоматически по расписанию
- ✅ Не требует внешних сервисов
- ✅ Бесплатно (минуты GitHub Actions)
- ✅ Код хранится в репозитории
- ✅ Простое управление версиями

#### Недостатки

- ❌ Основан на опросе (не в реальном времени)
- ❌ Требует управления состоянием
- ❌ Ограничен расписанием cron
- ❌ Необходимо учитывать ограничения частоты запросов

#### Стоимость

- Бесплатно (в пределах лимитов GitHub Actions)

---

## Сравнительная матрица

| Решение                          | Время настройки | Стоимость   | Реальное время | Кастомизация | Обслуживание | Лучше всего для                                    |
| -------------------------------- | --------------- | ----------- | -------------- | ------------ | ------------ | -------------------------------------------------- |
| **Нативная интеграция (ручная)** | 10 мин          | Бесплатно   | Нет            | Низкая       | Нет          | Быстрая настройка, малые команды                   |
| **Нативная интеграция (авто)**   | 15 мин          | $$          | Да             | Низкая       | Нет          | Enterprise, автоматизированный процесс             |
| **Кастомный скрипт (API)**       | 2–4 часа        | Бесплатно   | Нет            | Высокая      | Средняя      | Полный контроль, массовые операции                 |
| **Webhooks + сервис**            | 4–8 часов       | Хостинг     | Да             | Высокая      | Высокое      | Реальное время, большой масштаб                    |
| **Pipedream**                    | 30 мин          | Бесплатно/$ | Да             | Средняя      | Низкое       | Без кода, быстрое прототипирование                 |
| **n8n**                          | 2–3 часа        | Бесплатно\* | Да             | Высокая      | Среднее      | Самостоятельный хостинг, конфиденциальность данных |
| **Make.com**                     | 1 час           | Бесплатно/$ | Да             | Высокая      | Низкое       | Сложные рабочие процессы                           |
| **Zapier**                       | 30 мин          | $$          | Да             | Средняя      | Низкое       | Бизнес-пользователи, простота                      |
| **GitHub Actions**               | 2–3 часа        | Бесплатно   | Нет            | Высокая      | Среднее      | Интеграция CI/CD                                   |

\* Требует инфраструктуры для хостинга

---

## Рекомендации

### Для немедленного использования (на этой неделе)

**→ Нативная интеграция Sentry с GitHub (ручная)**

Начните с официальной интеграции для быстрых результатов:

1. Установите за 10 минут
2. Протестируйте с несколькими задачами вручную
3. Оцените, стоит ли обновлять план для автоматической версии

### Для производственного использования (долгосрочно)

**→ Кастомная реализация (Sentry API + GitHub API)**

Рекомендуется, потому что:

1. ✅ **Зависимость @sentry/node уже установлена** — используйте существующую интеграцию
2. ✅ **Полный контроль** — настройте формат задач, метки, логику назначения
3. ✅ **Интеграция с Hive Mind** — добавьте в существующий набор автоматизации
4. ✅ **Бесплатно** — без дополнительных затрат на подписку
5. ✅ **Масштабируемость** — начните просто, добавляйте функции со временем
6. ✅ **Массовые операции** — можно конвертировать существующие задачи

**План реализации:**

1. Создайте скрипт `scripts/sentry-to-github.mjs`
2. Используйте существующие учётные данные Sentry
3. Добавьте в npm scripts: `"sentry:sync": "node scripts/sentry-to-github.mjs"`
4. Настройте расписание с cron или GitHub Actions
5. (Необязательно) Расширьте до webhook-решения для работы в реальном времени

### Для требований к реальному времени

**→ Webhooks Sentry + кастомный сервис**

Если реальное время критично:

1. Расширьте кастомный скрипт до приёмника webhook
2. Разверните как микросервис (та же инфраструктура, что и hive-mind)
3. Используйте существующий конвейер развёртывания

### Для быстрого прототипирования без кода

**→ Pipedream**

Если вы хотите протестировать перед написанием кастомного кода:

1. Бесплатного уровня достаточно для тестирования
2. Можно экспортировать/перенести логику позже
3. Хорошо подходит для понимания потока данных

---

## Соображения по реализации

### Дедупликация

Отслеживайте синхронизированные задачи, чтобы избежать дублирования:

```javascript
const syncedIssues = new Map(); // sentryId -> githubIssueNumber
```

### Ограничения частоты запросов

- Sentry API: задокументированных ограничений нет, но будьте разумны
- GitHub API: 5 000 запросов/час для аутентифицированных запросов
- Добавляйте задержки между пакетными операциями

### Синхронизация статуса задач

Рассмотрите двунаправленную синхронизацию:

- Задача Sentry решена → Закрыть задачу GitHub
- Задача GitHub закрыта → Обновить статус задачи Sentry

### Метки и назначение

- Добавьте метку `sentry` для фильтрации
- Анализируйте тип ошибки для дополнительных меток (например, `TypeError`, `network-error`)
- Используйте данные fingerprint/user из Sentry для назначения

### Обработка ошибок

- Записывайте сбои для ручного просмотра
- Повторяйте при временных ошибках (сетевые проблемы)
- Оповещайте о постоянных сбоях

---

## Следующие шаги

1. **Немедленно:** Установите интеграцию Sentry с GitHub для ручного тестирования
2. **Неделя 1:** Создайте кастомный скрипт для массовой конвертации существующих задач
3. **Неделя 2–3:** Добавьте планирование (GitHub Actions или cron)
4. **В будущем:** Рассмотрите webhook-синхронизацию в реальном времени при необходимости

---

## Ссылки

### Документация Sentry

- GitHub Integration: https://docs.sentry.io/organization/integrations/source-code-mgmt/github/
- API Reference: https://docs.sentry.io/api/
- List Issues: https://docs.sentry.io/api/events/list-a-projects-issues/
- Webhooks: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/
- Auth Tokens: https://docs.sentry.io/api/guides/create-auth-token/

### Документация GitHub

- REST API: https://docs.github.com/en/rest
- Octokit.js: https://github.com/octokit/octokit.js
- Create Issue: https://docs.github.com/en/rest/issues/issues#create-an-issue

### Сторонние платформы

- Pipedream: https://pipedream.com/apps/sentry/integrations/github
- n8n: https://n8n.io/integrations/github/and/sentryio/
- Make.com: https://www.make.com/en/integrations/sentry
- Zapier: https://zapier.com

### Ресурсы сообщества

- Stack Overflow: https://stackoverflow.com/questions/79186277/is-there-a-github-action-to-fetch-sentry-issues-and-create-github-issues
- Sentry GitHub App: https://github.com/apps/sentry-io
