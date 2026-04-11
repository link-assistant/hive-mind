# Sentry 到 GitHub Issues 的通用集成 (languages: [en](sentry-github-universal-integration.md) • zh • [hi](sentry-github-universal-integration.hi.md) • [ru](sentry-github-universal-integration.ru.md))

## 目的

本指南提供了将 Sentry 问题转换为 GitHub Issues 的**通用解决方案**，适用于：

- ✅ **自托管 Sentry**（本地部署）
- ✅ **云托管 Sentry**（sentry.io）
- ✅ **受限环境**（防火墙、隔离网络、有限 API 访问）
- ✅ **所有 Sentry 计划**（Developer、Team、Business、Enterprise）

## 为什么需要本指南？

许多 Sentry 到 GitHub 的集成选项存在限制：

- Sentry 原生 GitHub 集成需要 Business/Enterprise 计划
- 第三方平台（Zapier、Pipedream）只适用于云端 Sentry
- 基于 Webhook 的解决方案需要公开可访问的端点
- 特定于平台的解决方案在受限环境中不起作用

本指南专注于**基于 API 的方法**，可以普遍适用。

## 核心方法：Sentry API + GitHub API

最通用的方法是直接调用两个平台的 API。无论以下情况如何，都可以使用：

- 您的 Sentry 托管类型（自托管或云端）
- 您的网络限制
- 您的 Sentry 订阅计划
- 您的部署环境

### 架构

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

## 步骤一：Sentry API 认证

### 对于云端 Sentry（sentry.io）

1. **创建 Auth Token：**
   - 导航到：https://sentry.io/settings/account/api/auth-tokens/
   - 点击"Create New Token"
   - 选择权限范围：`event:read`、`org:read`、`project:read`
   - 安全保存 token

2. **测试认证：**

```bash
curl -H "Authorization: Bearer YOUR_SENTRY_TOKEN" \
  https://sentry.io/api/0/organizations/YOUR_ORG/
```

### 对于自托管 Sentry

1. **创建 Auth Token：**
   - 导航到：`https://your-sentry-domain.com/settings/account/api/auth-tokens/`
   - 点击"Create New Token"
   - 选择权限范围：`event:read`、`org:read`、`project:read`
   - 安全保存 token

2. **测试认证：**

```bash
curl -H "Authorization: Bearer YOUR_SENTRY_TOKEN" \
  https://your-sentry-domain.com/api/0/organizations/YOUR_ORG/
```

**关键点：** 云端和自托管 Sentry 的 API 结构完全相同。

## 步骤二：GitHub API 认证

### 创建 Personal Access Token（经典版）

1. 导航到：https://github.com/settings/tokens
2. 点击"Generate new token (classic)"
3. 选择权限范围：
   - `repo`（私有仓库的完全控制）
   - `public_repo`（仅限公开仓库）
4. 生成并保存 token

### 测试认证

```bash
curl -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/user
```

## 步骤三：获取 Sentry Issues

### 通用 API 端点

```
GET {SENTRY_URL}/api/0/organizations/{organization_slug}/issues/
```

其中：

- `{SENTRY_URL}` = 云端为 `https://sentry.io`，自托管为 `https://your-domain.com`
- `{organization_slug}` = 您的组织标识符

### 查询参数

| 参数          | 描述                       | 示例                  |
| ------------- | -------------------------- | --------------------- |
| `query`       | 过滤 issues                | `is:unresolved`       |
| `statsPeriod` | 时间范围                   | `24h`、`7d`、`14d`    |
| `project`     | 按项目 ID 过滤             | `12345`               |
| `sort`        | 排序顺序                   | `date`、`freq`、`new` |
| `limit`       | 每页结果数（最多 100）     | `50`                  |
| `cursor`      | 分页游标                   | 来自 `Link` header    |

### 示例：获取未解决的 Issues

```bash
# For Cloud Sentry
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://sentry.io/api/0/organizations/YOUR_ORG/issues/?query=is:unresolved&limit=50"

# For Self-Hosted Sentry (same API structure)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://your-sentry.com/api/0/organizations/YOUR_ORG/issues/?query=is:unresolved&limit=50"
```

### 响应结构

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

## 步骤四：创建 GitHub Issues

### API 端点

```
POST https://api.github.com/repos/{owner}/{repo}/issues
```

### 示例请求

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

### 响应

```json
{
  "number": 42,
  "title": "🐛 Sentry: TypeError in getUserData",
  "html_url": "https://github.com/owner/repo/issues/42",
  "state": "open"
}
```

## 步骤五：实现脚本

### Node.js 实现

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

### 用法

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

## 步骤六：自动化与调度

### 选项 A：Cron Job（Linux/macOS）

适用于任何带有 cron 的环境。

```bash
# Edit crontab
crontab -e

# Run every hour
0 * * * * cd /path/to/script && /usr/bin/node sentry-github-sync.mjs >> /var/log/sentry-sync.log 2>&1

# Run every 6 hours
0 */6 * * * cd /path/to/script && /usr/bin/node sentry-github-sync.mjs >> /var/log/sentry-sync.log 2>&1
```

### 选项 B：systemd Timer（Linux）

创建 `/etc/systemd/system/sentry-sync.service`：

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

创建 `/etc/systemd/system/sentry-sync.timer`：

```ini
[Unit]
Description=Run Sentry sync every hour

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

启用并启动：

```bash
sudo systemctl enable sentry-sync.timer
sudo systemctl start sentry-sync.timer
sudo systemctl status sentry-sync.timer
```

### 选项 C：GitHub Actions（用于云端环境）

仅在您的 Sentry 实例可从 GitHub Actions runner 访问时有效。

`.github/workflows/sentry-sync.yml`：

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

### 选项 D：Docker 容器

适用于任何带有 Docker 的环境。

`Dockerfile`：

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY sentry-github-sync.mjs .
COPY package.json .

RUN npm install

CMD ["node", "sentry-github-sync.mjs"]
```

使用 cron 或调度器运行：

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

## 高级：过滤与优先级排序

### 按 Issue 优先级过滤

```javascript
// Fetch only high-priority issues
const params = new URLSearchParams({
  query: 'is:unresolved issue.priority:[high,medium]',
  statsPeriod: '24h',
  limit: '50',
});
```

### 按项目过滤

```javascript
// Fetch issues from specific project
const params = new URLSearchParams({
  query: 'is:unresolved',
  project: '12345', // Project ID
  statsPeriod: '24h',
});
```

### 按标签过滤

```javascript
// Fetch issues with specific tags
const params = new URLSearchParams({
  query: 'is:unresolved environment:production',
  statsPeriod: '24h',
});
```

### 自定义优先级标签

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

## 安全最佳实践

### 1. Token 存储

**永远不要将 token 提交到 git：**

```bash
# .gitenv
SENTRY_TOKEN=your-token
GITHUB_TOKEN=your-token

# .gitignore
.env
.env.*
sentry-sync-state.json
```

**使用环境变量或密钥管理：**

```bash
# Load from .env file
export $(cat .env | xargs)

# Or use secret management (e.g., HashiCorp Vault)
export SENTRY_TOKEN=$(vault kv get -field=token secret/sentry)
```

### 2. Token 权限

**最小化权限范围：**

- Sentry：`event:read`、`org:read`、`project:read`（无写入权限）
- GitHub：仅 `repo` 或 `public_repo`（无管理员或删除权限）

### 3. 网络安全

**对于自托管 Sentry：**

- 所有 API 调用使用 HTTPS
- 验证 SSL 证书
- 考虑使用 VPN 或私有网络访问内部 Sentry

```javascript
// Enable SSL verification
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  // Node.js will verify SSL by default
});
```

### 4. 速率限制

**遵守 API 速率限制：**

```javascript
// Add delay between requests
await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second

// Sentry rate limits: 20,000 requests per hour (cloud)
// GitHub rate limits: 5,000 requests per hour for authenticated requests
```

### 5. 错误处理

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

## 故障排除

### 问题：来自 Sentry 的"Unauthorized"错误

**原因：**

- 无效或过期的 auth token
- token 权限不足
- 错误的组织 slug

**解决方案：**

```bash
# Test token
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/${SENTRY_ORG}/

# Verify token scopes in Sentry UI
# Regenerate token if needed
```

### 问题：来自 Sentry 的"Not Found"错误

**原因：**

- 错误的组织 slug
- 错误的 Sentry URL（自托管）
- 项目不存在

**解决方案：**

```bash
# List all organizations
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/

# List all projects
curl -H "Authorization: Bearer YOUR_TOKEN" \
  ${SENTRY_URL}/api/0/organizations/${SENTRY_ORG}/projects/
```

### 问题：GitHub API 速率限制

**原因：**

- 短时间内请求过多
- 使用未认证请求

**解决方案：**

```bash
# Check rate limit status
curl -H "Authorization: Bearer YOUR_GITHUB_TOKEN" \
  https://api.github.com/rate_limit

# Add delays between requests
# Use conditional requests with ETag
```

### 问题：创建了重复的 Issues

**原因：**

- 状态文件未持久化
- 状态文件损坏
- 同时运行多个实例

**解决方案：**

```javascript
// Ensure state file is writable
await fs.access(CONFIG.STATE_FILE, fs.constants.W_OK);

// Use file locking for concurrent access
import lockfile from 'proper-lockfile';
await lockfile.lock(CONFIG.STATE_FILE);

// Add unique identifier to GitHub issue
// Search existing issues before creating
```

### 问题：自托管 Sentry SSL 验证失败

**原因：**

- 自签名 SSL 证书
- 证书不受系统信任

**解决方案：**

```javascript
// Option 1: Add certificate to system trust store (recommended)

// Option 2: Disable SSL verification (NOT recommended for production)
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false,
});

fetch(url, { agent });
```

## 性能优化

### 1. 大型结果集的分页

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

### 2. 批量处理

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

### 3. 增量同步

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

## 总结

### 普遍适用的内容

✅ **Sentry API 访问** - 云端和自托管使用相同的 API
✅ **GitHub API 访问** - 可从任何有互联网的环境使用
✅ **基于 API 的同步脚本** - 无平台依赖
✅ **Cron/systemd 调度** - 适用于任何 Linux/Unix 系统
✅ **Docker 部署** - 跨环境可移植
✅ **状态管理** - 基于文件，无外部依赖

### 有限制的内容

⚠️ **Sentry 原生集成** - 需要 Business/Enterprise 计划
⚠️ **第三方平台** - 只适用于云端 Sentry
⚠️ **Webhooks** - 需要公开可访问的端点
⚠️ **GitHub Actions** - 需要 GitHub 可访问的 Sentry 实例

### 推荐设置

**对于大多数环境：**

1. 使用上面提供的 Node.js 脚本
2. 使用 cron 或 systemd 调度
3. 将状态存储在文件中
4. 监控日志以排查错误

**对于受限环境：**

1. 在可以访问 Sentry 和 GitHub 的内部服务器上部署脚本
2. 使用环境变量进行配置
3. 按计划运行（每小时或每天）
4. 不需要外部依赖

## 后续步骤

1. **使用您的 Sentry 和 GitHub 实例测试脚本**
2. **调整过滤器**以匹配您的需求（优先级、项目、标签）
3. **根据您的环境设置调度**
4. **监控并迭代** issue 格式和标签
5. **考虑增强功能**，如双向同步、自动关闭已解决的 issues

## 参考资料

- [Sentry API 文档](https://docs.sentry.io/api/)
- [GitHub REST API 文档](https://docs.github.com/en/rest)
- [Sentry 自托管文档](https://develop.sentry.dev/self-hosted/)
