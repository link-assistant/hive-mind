# Универсальная интеграция Sentry с GitHub Issues (languages: [en](sentry-github-universal-integration.md) • [zh](sentry-github-universal-integration.zh.md) • [hi](sentry-github-universal-integration.hi.md) • ru)

## Назначение

Это руководство предоставляет **универсальное решение** для преобразования задач Sentry в задачи GitHub, которое работает с:

- ✅ **Self-hosted Sentry** (локальные развёртывания)
- ✅ **Cloud-hosted Sentry** (sentry.io)
- ✅ **Ограниченными средами** (брандмауэр, изолированные сети, ограниченный доступ к API)
- ✅ **Всеми планами Sentry** (Developer, Team, Business, Enterprise)

## Зачем это руководство?

Многие варианты интеграции Sentry с GitHub имеют ограничения:

- Нативная интеграция Sentry с GitHub требует плана Business/Enterprise
- Сторонние платформы (Zapier, Pipedream) работают только с облачным Sentry
- Решения на основе webhook требуют публично доступных конечных точек
- Платформо-специфичные решения не работают в ограниченных средах

Это руководство сосредоточено на **подходах на основе API**, которые работают универсально.

## Основной подход: Sentry API + GitHub API

Наиболее универсальный подход использует прямые вызовы API обеих платформ. Это работает независимо от:

- Типа хостинга Sentry (self-hosted или cloud)
- Сетевых ограничений
- Плана подписки Sentry
- Среды развёртывания

### Архитектура

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Sentry API    │   ←──   │  Integration     │   ──→   │   GitHub API    │
│ (Self-hosted or │         │     Script       │         │                 │
│     Cloud)      │         │  (Node.js/Bash)  │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │  State Storage   │
                            │ (File/DB/Memory) │
                            └──────────────────┘
```

## Шаг 1: Аутентификация в Sentry API

### Для Cloud Sentry (sentry.io)

1. **Создайте токен аутентификации:**
   - Перейдите по адресу: https://sentry.io/settings/account/api/auth-tokens/
   - Нажмите «Create New Token»
   - Выберите области: `event:read`, `org:read`, `project:read`
   - Сохраните токен в безопасном месте

2. **Проверьте аутентификацию:**

```bash
curl -H "Authorization: Bearer YOUR_SENTRY_TOKEN" \
  https://sentry.io/api/0/organizations/YOUR_ORG/
```

### Для Self-Hosted Sentry

1. **Создайте токен аутентификации:**
   - Перейдите по адресу: `https://your-sentry-domain.com/settings/account/api/auth-tokens/`
   - Нажмите «Create New Token»
   - Выберите области: `event:read`, `org:read`, `project:read`
   - Сохраните токен в безопасном месте

2. **Проверьте аутентификацию:**

```bash
curl -H "Authorization: Bearer YOUR_SENTRY_TOKEN" \
  https://your-sentry-domain.com/api/0/organizations/YOUR_ORG/
```

**Ключевой момент:** Структура API идентична для облачного и self-hosted Sentry.

## Шаг 2: Аутентификация в GitHub API

### Создайте персональный токен доступа (Classic)

1. Перейдите по адресу: https://github.com/settings/tokens
2. Нажмите «Generate new token (classic)»
3. Выберите области:
   - `repo` (полный контроль приватных репозиториев)
   - `public_repo` (только для публичных репозиториев)
4. Сгенерируйте и сохраните токен

### Проверьте аутентификацию

```bash
curl -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/user
```

## Шаг 3: Получение задач Sentry

### Универсальная конечная точка API

```
GET {SENTRY_URL}/api/0/organizations/{organization_slug}/issues/
```

Где:

- `{SENTRY_URL}` = `https://sentry.io` для cloud, `https://your-domain.com` для self-hosted
- `{organization_slug}` = идентификатор вашей организации

### Параметры запроса

| Параметр      | Описание                            | Пример                |
| ------------- | ----------------------------------- | --------------------- |
| `query`       | Фильтр задач                        | `is:unresolved`       |
| `statsPeriod` | Временной диапазон                  | `24h`, `7d`, `14d`    |
| `project`     | Фильтр по ID проекта                | `12345`               |
| `sort`        | Порядок сортировки                  | `date`, `freq`, `new` |
| `limit`       | Результатов на страницу (макс. 100) | `50`                  |
| `cursor`      | Курсор пагинации                    | Из заголовка `Link`   |

### Пример: Получение неразрешённых задач

```bash
# For Cloud Sentry
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://sentry.io/api/0/organizations/YOUR_ORG/issues/?query=is:unresolved&limit=50"

# For Self-Hosted Sentry (same API structure)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://your-sentry.com/api/0/organizations/YOUR_ORG/issues/?query=is:unresolved&limit=50"
```

### Структура ответа

```json
[
  {
    "id": "1234567890",
    "title": "TypeError: Cannot read property 'x' of undefined",
    "culprit": "app/controllers/user.js in getUserData",
    "permalink": "https://sentry.io/organizations/org/issues/1234567890/",
    "shortId": "PROJECT-123",
    "metadata": {
      "type": "TypeError",
      "value": "Cannot read property 'x' of undefined"
    },
    "level": "error",
    "status": "unresolved",
    "count": "45",
    "userCount": 12,
    "firstSeen": "2025-10-01T10:30:00Z",
    "lastSeen": "2025-10-02T14:20:00Z",
    "project": {
      "id": "12345",
      "name": "my-project",
      "slug": "my-project"
    }
  }
]
```

## Шаг 4: Создание задач GitHub

### Конечная точка API

```
POST https://api.github.com/repos/{owner}/{repo}/issues
```

### Пример запроса

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/OWNER/REPO/issues \
  -d '{
    "title": "🐛 Sentry: TypeError in getUserData",
    "body": "**Sentry Issue:** https://sentry.io/issues/1234567890/\n\n**Error Type:** TypeError\n**Message:** Cannot read property '\''x'\'' of undefined\n**Location:** app/controllers/user.js\n\n**Statistics:**\n- Events: 45\n- Users affected: 12\n- First seen: 2025-10-01T10:30:00Z\n- Last seen: 2025-10-02T14:20:00Z",
    "labels": ["sentry", "bug", "automated"]
  }'
```

### Ответ

```json
{
  "number": 42,
  "title": "🐛 Sentry: TypeError in getUserData",
  "html_url": "https://github.com/owner/repo/issues/42",
  "state": "open"
}
```

## Шаг 5: Скрипт реализации

### Реализация на Node.js

```javascript
#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

// Configuration
const CONFIG = {
  // Works for both cloud and self-hosted
  SENTRY_URL: process.env.SENTRY_URL || 'https://sentry.io',
  SENTRY_TOKEN: process.env.SENTRY_TOKEN,
  SENTRY_ORG: process.env.SENTRY_ORG,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_REPO: process.env.GITHUB_REPO, // format: "owner/repo"
  STATE_FILE: process.env.STATE_FILE || './sentry-sync-state.json',
};

// State management to prevent duplicates
async function loadState() {
  try {
    const data = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { synced: {} };
  }
}

async function saveState(state) {
  await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
}

// Fetch issues from Sentry (works for both cloud and self-hosted)
async function fetchSentryIssues() {
  const url = `${CONFIG.SENTRY_URL}/api/0/organizations/${CONFIG.SENTRY_ORG}/issues/`;
  const params = new URLSearchParams({
    query: 'is:unresolved',
    statsPeriod: '24h',
    limit: '50',
  });

  const response = await fetch(`${url}?${params}`, {
    headers: {
      Authorization: `Bearer ${CONFIG.SENTRY_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Sentry API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Create GitHub issue
async function createGitHubIssue(sentryIssue) {
  const [owner, repo] = CONFIG.GITHUB_REPO.split('/');

  const issueBody = [`**Sentry Issue:** ${sentryIssue.permalink}`, ``, `**Error Type:** ${sentryIssue.metadata?.type || 'Unknown'}`, `**Message:** ${sentryIssue.metadata?.value || sentryIssue.title}`, `**Location:** ${sentryIssue.culprit || 'Unknown'}`, ``, `**Statistics:**`, `- Events: ${sentryIssue.count}`, `- Users affected: ${sentryIssue.userCount}`, `- First seen: ${sentryIssue.firstSeen}`, `- Last seen: ${sentryIssue.lastSeen}`, ``, `**Project:** ${sentryIssue.project?.name || 'Unknown'}`, `**Short ID:** ${sentryIssue.shortId}`].join('\n');

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CONFIG.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `🐛 Sentry: ${sentryIssue.title}`,
      body: issueBody,
      labels: ['sentry', 'bug', 'automated'],
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Main sync function
async function sync() {
  console.log('Starting Sentry → GitHub sync...');

  // Load state
  const state = await loadState();

  // Fetch Sentry issues
  console.log('Fetching issues from Sentry...');
  const sentryIssues = await fetchSentryIssues();
  console.log(`Found ${sentryIssues.length} issues`);

  // Process each issue
  let created = 0;
  let skipped = 0;

  for (const issue of sentryIssues) {
    // Skip if already synced
    if (state.synced[issue.id]) {
      skipped++;
      continue;
    }

    try {
      console.log(`Creating GitHub issue for Sentry issue ${issue.shortId}...`);
      const githubIssue = await createGitHubIssue(issue);

      // Mark as synced
      state.synced[issue.id] = {
        githubIssueNumber: githubIssue.number,
        githubIssueUrl: githubIssue.html_url,
        syncedAt: new Date().toISOString(),
      };

      created++;
      console.log(`✓ Created GitHub issue #${githubIssue.number}`);

      // Rate limiting: wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`✗ Failed to create issue for ${issue.shortId}:`, error.message);
    }
  }

  // Save state
  await saveState(state);

  console.log(`\nSync complete:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
}

// Run
sync().catch(error => {
  console.error('Sync failed:', error);
  process.exit(1);
});
```

### Использование

```bash
# For Cloud Sentry
export SENTRY_URL="https://sentry.io"
export SENTRY_TOKEN="your-sentry-token"
export SENTRY_ORG="your-org-slug"
export GITHUB_TOKEN="your-github-token"
export GITHUB_REPO="owner/repo"

node sentry-github-sync.mjs

# For Self-Hosted Sentry (just change SENTRY_URL)
export SENTRY_URL="https://your-sentry-domain.com"
export SENTRY_TOKEN="your-sentry-token"
export SENTRY_ORG="your-org-slug"
export GITHUB_TOKEN="your-github-token"
export GITHUB_REPO="owner/repo"

node sentry-github-sync.mjs
```

## Шаг 6: Автоматизация и планирование

### Вариант A: Cron Job (Linux/macOS)

Работает в любой среде с cron.

```bash
# Edit crontab
crontab -e

# Run every hour
0 * * * * cd /path/to/script && /usr/bin/node sentry-github-sync.mjs >> /var/log/sentry-sync.log 2>&1

# Run every 6 hours
0 */6 * * * cd /path/to/script && /usr/bin/node sentry-github-sync.mjs >> /var/log/sentry-sync.log 2>&1
```

### Вариант B: Таймер systemd (Linux)

Создайте `/etc/systemd/system/sentry-sync.service`:

```ini
[Unit]
Description=Sync Sentry Issues to GitHub
After=network.target

[Service]
Type=oneshot
User=youruser
WorkingDirectory=/path/to/script
Environment="SENTRY_URL=https://sentry.io"
Environment="SENTRY_TOKEN=your-token"
Environment="SENTRY_ORG=your-org"
Environment="GITHUB_TOKEN=your-token"
Environment="GITHUB_REPO=owner/repo"
ExecStart=/usr/bin/node sentry-github-sync.mjs
```

Создайте `/etc/systemd/system/sentry-sync.timer`:

```ini
[Unit]
Description=Run Sentry sync every hour

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Включите и запустите:

```bash
sudo systemctl enable sentry-sync.timer
sudo systemctl start sentry-sync.timer
sudo systemctl status sentry-sync.timer
```

### Вариант C: GitHub Actions (для облачных сред)

Работает только если ваш экземпляр Sentry доступен с runner'ов GitHub Actions.

`.github/workflows/sentry-sync.yml`:

```yaml
name: Sync Sentry to GitHub Issues

on:
  schedule:
    # Run every 6 hours
    - cron: '0 */6 * * *'
  workflow_dispatch: # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run Sync
        env:
          SENTRY_URL: ${{ secrets.SENTRY_URL }}
          SENTRY_TOKEN: ${{ secrets.SENTRY_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPO: ${{ github.repository }}
        run: node scripts/sentry-github-sync.mjs
```

### Вариант D: Docker-контейнер

Работает в любой среде с Docker.

`Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY sentry-github-sync.mjs .
COPY package.json .

RUN npm install

CMD ["node", "sentry-github-sync.mjs"]
```

Запустите с cron или планировщиком:

```bash
docker build -t sentry-sync .

# Run once
docker run --rm \
  -e SENTRY_URL="https://sentry.io" \
  -e SENTRY_TOKEN="your-token" \
  -e SENTRY_ORG="your-org" \
  -e GITHUB_TOKEN="your-token" \
  -e GITHUB_REPO="owner/repo" \
  -v $(pwd)/state:/app/state \
  sentry-sync

# Schedule with cron
0 * * * * docker run --rm -e SENTRY_URL="..." sentry-sync
```

## Расширенные возможности: Фильтрация и приоритизация

### Фильтрация по приоритету задач

```javascript
// Fetch only high-priority issues
const params = new URLSearchParams({
  query: 'is:unresolved issue.priority:[high,medium]',
  statsPeriod: '24h',
  limit: '50',
});
```

### Фильтрация по проекту

```javascript
// Fetch issues from specific project
const params = new URLSearchParams({
  query: 'is:unresolved',
  project: '12345', // Project ID
  statsPeriod: '24h',
});
```

### Фильтрация по тегам

```javascript
// Fetch issues with specific tags
const params = new URLSearchParams({
  query: 'is:unresolved environment:production',
  statsPeriod: '24h',
});
```

### Кастомные метки приоритета

```javascript
function getPriorityLabel(sentryIssue) {
  const eventCount = parseInt(sentryIssue.count);
  const userCount = sentryIssue.userCount;

  if (eventCount > 100 || userCount > 50) return 'priority:critical';
  if (eventCount > 50 || userCount > 20) return 'priority:high';
  if (eventCount > 10 || userCount > 5) return 'priority:medium';
  return 'priority:low';
}

// Add to GitHub issue labels
labels: ['sentry', 'bug', 'automated', getPriorityLabel(sentryIssue)];
```

## Лучшие практики безопасности

### 1. Хранение токенов

**Никогда не коммитьте токены в git:**

```bash
# .gitenv
SENTRY_TOKEN=your-token
GITHUB_TOKEN=your-token

# .gitignore
.env
.env.*
sentry-sync-state.json
```

**Используйте переменные среды или управление секретами:**

```bash
# Load from .env file
export $(cat .env | xargs)

# Or use secret management (e.g., HashiCorp Vault)
export SENTRY_TOKEN=$(vault kv get -field=token secret/sentry)
```

### 2. Разрешения токенов

**Минимизируйте области:**

- Sentry: `event:read`, `org:read`, `project:read` (без прав записи)
- GitHub: только `repo` или `public_repo` (без прав администратора или удаления)

### 3. Сетевая безопасность

**Для self-hosted Sentry:**

- Используйте HTTPS для всех вызовов API
- Проверяйте SSL-сертификаты
- Рассмотрите VPN или частную сеть для внутреннего Sentry

```javascript
// Enable SSL verification
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  // Node.js will verify SSL by default
});
```

### 4. Ограничения частоты запросов

**Соблюдайте ограничения частоты API:**

```javascript
// Add delay between requests
await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second

// Sentry rate limits: 20,000 requests per hour (cloud)
// GitHub rate limits: 5,000 requests per hour for authenticated requests
```

### 5. Обработка ошибок

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
        console.log(`Rate limited. Waiting ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Retry ${i + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}
```

## Устранение неполадок

### Проблема: Ошибка «Unauthorized» от Sentry

**Причины:**

- Недействительный или просроченный токен аутентификации
- Недостаточные разрешения токена
- Неверный slug организации

**Решения:**

```bash
# Test token
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/${SENTRY_ORG}/

# Verify token scopes in Sentry UI
# Regenerate token if needed
```

### Проблема: Ошибка «Not Found» от Sentry

**Причины:**

- Неверный slug организации
- Неправильный URL Sentry (self-hosted)
- Проект не существует

**Решения:**

```bash
# List all organizations
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/

# List all projects
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/${SENTRY_ORG}/projects/
```

### Проблема: Превышение лимита частоты запросов GitHub API

**Причины:**

- Слишком много запросов за короткое время
- Использование неаутентифицированных запросов

**Решения:**

```bash
# Check rate limit status
curl -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/rate_limit

# Add delays between requests
# Use conditional requests with ETag
```

### Проблема: Созданы дублирующиеся задачи

**Причины:**

- Файл состояния не сохраняется
- Повреждение файла состояния
- Одновременное выполнение нескольких экземпляров

**Решения:**

```javascript
// Ensure state file is writable
await fs.access(CONFIG.STATE_FILE, fs.constants.W_OK);

// Use file locking for concurrent access
import lockfile from 'proper-lockfile';
await lockfile.lock(CONFIG.STATE_FILE);

// Add unique identifier to GitHub issue
// Search existing issues before creating
```

### Проблема: Ошибка проверки SSL для Self-Hosted Sentry

**Причины:**

- Самоподписанный SSL-сертификат
- Сертификат не доверен системой

**Решения:**

```javascript
// Option 1: Add certificate to system trust store (recommended)

// Option 2: Disable SSL verification (NOT recommended for production)
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false,
});

fetch(url, { agent });
```

## Оптимизация производительности

### 1. Пагинация для больших наборов результатов

```javascript
async function fetchAllSentryIssues() {
  let allIssues = [];
  let cursor = null;

  do {
    const url = new URL(`${CONFIG.SENTRY_URL}/api/0/organizations/${CONFIG.SENTRY_ORG}/issues/`);
    url.searchParams.set('query', 'is:unresolved');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${CONFIG.SENTRY_TOKEN}` },
    });

    const issues = await response.json();
    allIssues.push(...issues);

    // Get next cursor from Link header
    const linkHeader = response.headers.get('Link');
    cursor = parseLinkHeader(linkHeader)?.next?.cursor;
  } while (cursor);

  return allIssues;
}
```

### 2. Пакетная обработка

```javascript
// Process in batches to avoid memory issues
const BATCH_SIZE = 10;

for (let i = 0; i < issues.length; i += BATCH_SIZE) {
  const batch = issues.slice(i, i + BATCH_SIZE);

  await Promise.all(batch.map(issue => createGitHubIssue(issue)));

  // Rate limiting delay
  await new Promise(resolve => setTimeout(resolve, 5000));
}
```

### 3. Инкрементальная синхронизация

```javascript
// Only fetch issues since last sync
const state = await loadState();
const lastSyncTime = state.lastSync || '24h';

const params = new URLSearchParams({
  query: 'is:unresolved',
  statsPeriod: lastSyncTime,
});

// Update last sync time
state.lastSync = new Date().toISOString();
await saveState(state);
```

## Итог

### Что работает универсально

✅ **Доступ к Sentry API** — одинаковый API для cloud и self-hosted
✅ **Доступ к GitHub API** — работает из любой среды с интернетом
✅ **Скрипт синхронизации на основе API** — нет зависимостей от платформы
✅ **Планирование через Cron/systemd** — работает на любой Linux/Unix-системе
✅ **Развёртывание в Docker** — переносимость между средами
✅ **Управление состоянием** — на основе файлов, без внешних зависимостей

### Что имеет ограничения

⚠️ **Нативная интеграция Sentry** — требует плана Business/Enterprise
⚠️ **Сторонние платформы** — работают только с облачным Sentry
⚠️ **Webhooks** — требуют публично доступных конечных точек
⚠️ **GitHub Actions** — требует экземпляра Sentry, доступного из GitHub

### Рекомендуемая настройка

**Для большинства сред:**

1. Используйте предоставленный выше скрипт Node.js
2. Настройте расписание с cron или systemd
3. Храните состояние в файле
4. Отслеживайте журналы на предмет ошибок

**Для ограниченных сред:**

1. Разверните скрипт на внутреннем сервере с доступом к Sentry и GitHub
2. Используйте переменные среды для конфигурации
3. Запускайте по расписанию (ежечасно или ежедневно)
4. Внешние зависимости не требуются

## Следующие шаги

1. **Протестируйте скрипт** с вашими экземплярами Sentry и GitHub
2. **Настройте фильтры** под свои нужды (приоритет, проект, теги)
3. **Настройте расписание** в зависимости от вашей среды
4. **Ведите мониторинг и итерируйте** формат задач и метки
5. **Рассмотрите улучшения**, например двунаправленную синхронизацию, автоматическое закрытие решённых задач

## Ссылки

- [Документация Sentry API](https://docs.sentry.io/api/)
- [Документация GitHub REST API](https://docs.github.com/en/rest)
- [Документация Sentry Self-Hosted](https://develop.sentry.dev/self-hosted/)
