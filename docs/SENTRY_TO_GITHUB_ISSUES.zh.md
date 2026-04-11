# 将 Sentry 问题转换为 GitHub Issues：综合分析 (languages: [en](SENTRY_TO_GITHUB_ISSUES.md) • zh • [hi](SENTRY_TO_GITHUB_ISSUES.hi.md) • [ru](SENTRY_TO_GITHUB_ISSUES.ru.md))

## 概述

本文档探讨了将 Sentry 问题转换为 Hive Mind 项目 GitHub Issues 的所有可用选项。我们的 Sentry 实例位于 https://deepassistant.sentry.io/issues。

## 解决方案选项

### 1. Sentry 原生 GitHub 集成 ⭐ 推荐用于快速设置

#### 概述

Sentry 提供内置的 GitHub 集成，允许直接从 Sentry 创建和关联 GitHub issues。

#### 功能

**手动创建 Issue：**

- 导航到任意 Sentry issue
- 使用右侧面板中的"Linked Issues"部分
- 点击创建新的 GitHub issue
- 根据 CODEOWNERS 文件自动建议指派人
- 在 Sentry 和 GitHub 之间创建双向链接

**自动创建 Issue：**

- 在 Sentry 中配置 Issue Alerts
- 向告警规则添加"Create a new GitHub issue"操作
- 告警触发时自动创建 GitHub issues
- 仅适用于 Business 或 Enterprise 计划

#### 设置步骤

1. 导航到 Sentry Settings > Integrations
2. 选择 GitHub 集成
3. 安装 Sentry GitHub App
4. 连接您的 GitHub 仓库
5. （可选）上传 CODEOWNERS 文件以实现自动分配
6. 配置 Issue Alerts 以实现自动创建

#### 优点

- ✅ Sentry 官方维护的集成
- ✅ 零代码要求
- ✅ 双向关联（Sentry ↔ GitHub）
- ✅ 基于 CODEOWNERS 自动分配
- ✅ 支持 PR 评论和发布
- ✅ 快速设置（5-10 分钟）

#### 缺点

- ❌ 自动创建需要 Business/Enterprise 计划
- ❌ issue 格式定制有限
- ❌ 免费计划需要手动点击
- ❌ 无法批量转换现有 issues

#### 费用

- 手动：所有计划可用（Team、Business、Enterprise）
- 自动：仅限 Business/Enterprise 计划

#### 文档

- https://docs.sentry.io/organization/integrations/source-code-mgmt/github/
- https://sentry.io/integrations/github/

---

### 2. 使用 Sentry API + GitHub API 自定义实现 ⭐ 推荐用于完全控制

#### 概述

使用 Sentry REST API 获取 issues 并使用 GitHub Octokit 以编程方式创建 issues，构建自定义脚本或服务。

#### 架构

```
Sentry API → Custom Script → GitHub API
    ↓              ↓              ↓
Fetch Issues   Transform     Create Issues
```

#### 实现示例

**依赖项：**

```bash
npm install @sentry/node octokit
```

**示例代码：**

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

#### 设置步骤

1. 创建 Sentry Auth Token（Settings > Account > API > Auth Tokens）
2. 创建具有 `repo` 权限的 GitHub Personal Access Token
3. 安装依赖项：`npm install octokit`
4. 使用身份验证创建脚本
5. 手动运行或使用 cron/GitHub Actions 定期执行

#### Sentry API 详情

**端点：** `GET /api/0/projects/{org_slug}/{project_slug}/issues/`

**认证：** Authorization header 中的 Bearer token

**关键参数：**

- `query`：过滤 issues（例如 `is:unresolved`、`is:unresolved is:for_review`）
- `statsPeriod`：时间范围（`24h`、`14d`）
- `cursor`：分页

**响应包含：**

- Issue ID、标题、状态
- 首次发现、最后发现时间戳
- 事件数量、用户数量
- 元数据（错误类型、值）
- Sentry UI 的永久链接

#### GitHub API 详情

**端点：** `POST /repos/{owner}/{repo}/issues`

**认证：** Personal Access Token

**参数：**

- `title`：Issue 标题（必填）
- `body`：Issue 描述（可选）
- `labels`：标签名称数组
- `assignees`：GitHub 用户名数组
- `milestone`：里程碑编号

#### 优点

- ✅ 完全控制 issue 格式和内容
- ✅ 可以批量转换现有 issues
- ✅ 可自定义过滤和转换
- ✅ 可添加自定义标签、指派人、里程碑
- ✅ 适用于免费 Sentry 计划
- ✅ 可以按计划或事件驱动
- ✅ 已安装 @sentry/node

#### 缺点

- ❌ 需要开发和维护
- ❌ 需要处理速率限制
- ❌ 需要跟踪哪些 issues 已转换
- ❌ 开箱即用不支持双向同步

#### 费用

- 免费（使用 Sentry API + GitHub API）

#### 文档

- Sentry API：https://docs.sentry.io/api/events/list-a-projects-issues/
- GitHub Octokit：https://github.com/octokit/octokit.js
- GitHub Issues API：https://docs.github.com/en/rest/issues/issues

---

### 3. Sentry Webhooks + 自定义服务 ⭐ 推荐用于实时处理

#### 概述

使用 Sentry 的 webhook 集成，在 issues 创建或更新时接收实时通知，然后自动创建 GitHub issues。

#### 架构

```
Sentry Issue Created/Updated
         ↓
   Sentry Webhook
         ↓
   Your Web Service (Express.js)
         ↓
   GitHub API (Create Issue)
```

#### 实现示例

**依赖项：**

```bash
npm install express octokit
```

**示例代码：**

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

#### Webhook 载荷

**Header：** `Sentry-Hook-Resource: issue`

**操作：** `created`、`resolved`、`assigned`、`archived`、`unresolved`

**载荷包含：**

- Issue URL、项目 URL
- 状态和子状态
- 状态详情（解决信息）
- 完整 issue 元数据

#### 设置步骤

1. 在 Sentry 创建内部集成（Settings > Custom Integrations）
2. 配置 webhook URL（您的公开端点）
3. 订阅"Issue"事件
4. 部署 webhook 接收服务
5. 用示例 issues 进行测试

#### 优点

- ✅ 实时 issue 创建（即时）
- ✅ 事件驱动，无需轮询
- ✅ 可以响应状态变化（已解决、重新开启）
- ✅ 资源占用少
- ✅ 可扩展架构

#### 缺点

- ❌ 需要托管 Web 服务
- ❌ 需要公开的 HTTPS 端点
- ❌ 设置更复杂
- ❌ 需要处理 webhook 重试和失败

#### 费用

- 免费（Sentry webhooks + GitHub API）
- webhook 服务的托管费用（因情况而异）

#### 文档

- https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/

---

### 4. 第三方自动化平台

#### 4.1 Pipedream ⭐ 最简单的无代码选项

**概述：** 低代码平台，提供预构建的 Sentry → GitHub 工作流

**功能：**

- 预构建工作流模板
- "Create GitHub Issue on New Sentry Issue Event"
- 可视化工作流构建器
- 两个服务的内置身份验证
- 无服务器执行

**设置：**

1. 在 https://pipedream.com 注册
2. 选择"Sentry API"触发器："New Issue Event (Instant)"
3. 添加"GitHub API"操作："Create Issue"
4. 从 Sentry 到 GitHub 映射字段
5. 部署工作流

**优点：**

- ✅ 零代码要求
- ✅ 提供预构建模板
- ✅ 可视化工作流构建器
- ✅ 提供免费层（100 次调用/天）
- ✅ 包含托管服务

**缺点：**

- ❌ 免费层定制有限
- ❌ 供应商锁定
- ❌ 免费计划有使用限制

**费用：** 免费层（100 次调用/天），付费（$19/月起）

**URL：** https://pipedream.com/apps/sentry/integrations/github

---

#### 4.2 n8n - 自托管替代方案

**概述：** 开源工作流自动化，可自托管

**功能：**

- 可视化工作流构建器
- 可用 Sentry + GitHub 节点
- 自托管（完全控制）
- 可在您的基础设施上运行

**设置：**

1. 部署 n8n（Docker/npm）
2. 使用 Sentry 触发器创建工作流
3. 添加 GitHub"Create Issue"节点
4. 配置字段映射
5. 激活工作流

**优点：**

- ✅ 开源且免费
- ✅ 自托管（数据保留在您处）
- ✅ 无限执行次数
- ✅ 完全自定义
- ✅ SOC2 合规

**缺点：**

- ❌ 需要托管/基础设施
- ❌ 设置更复杂
- ❌ 需要自行维护

**费用：** 免费（自托管）或云端（$20/月起）

**URL：** https://n8n.io/integrations/github/and/sentryio/

---

#### 4.3 Make.com（原 Integromat）

**概述：** 支持 Sentry 和 GitHub 的可视化自动化平台

**功能：**

- 可视化场景构建器
- Sentry 模块：检索 issues
- GitHub 模块：创建 issues、PR、评论
- 高级路由和过滤

**设置：**

1. 在 https://www.make.com 注册
2. 创建新场景
3. 添加 Sentry 模块（触发器或操作）
4. 添加 GitHub"Create Issue"模块
5. 映射数据字段
6. 运行场景

**优点：**

- ✅ 可视化无代码构建器
- ✅ 高级功能（路由、过滤）
- ✅ 免费层（1,000 次操作/月）
- ✅ 文档完善

**缺点：**

- ❌ 学习曲线较陡
- ❌ 定价模型复杂
- ❌ 免费层操作次数有限

**费用：** 免费层（1,000 次操作/月），付费（$9/月起）

**URL：**

- Sentry：https://www.make.com/en/integrations/sentry
- GitHub：https://www.make.com/en/integrations/github

---

#### 4.4 Zapier - 集成最多

**概述：** 市场领先的自动化平台，支持 7,000+ 应用

**功能：**

- 简单工作流构建器（Zaps）
- 可用 Sentry 集成
- 可用 GitHub 集成
- 最适合商业用户

**设置：**

1. 在 https://zapier.com 注册
2. 创建新 Zap
3. 触发器：Sentry（需要 webhook 设置）
4. 操作：GitHub"Create Issue"
5. 映射字段并启用

**优点：**

- ✅ 对非技术用户最友好
- ✅ 最成熟的平台
- ✅ 丰富的应用生态系统
- ✅ 完善的支持和文档

**缺点：**

- ❌ 价格较贵
- ❌ Sentry 集成有限
- ❌ 免费层非常有限（100 次任务/月）

**费用：** 免费层（100 次任务/月），付费（$19.99/月起）

---

### 5. GitHub Actions 自定义工作流

#### 概述

创建定期轮询 Sentry API 并创建 issues 的 GitHub Action

#### 实现示例

**.github/workflows/sentry-sync.yml：**

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

**scripts/sync-sentry-issues.js：**

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

#### 优点

- ✅ 按计划自动运行
- ✅ 不需要外部服务
- ✅ 免费（GitHub Actions 分钟数）
- ✅ 代码存储在仓库中
- ✅ 易于版本控制

#### 缺点

- ❌ 基于轮询（非实时）
- ❌ 需要状态管理
- ❌ 受限于 cron 计划
- ❌ 需要考虑速率限制

#### 费用

- 免费（在 GitHub Actions 限制内）

---

## 对比矩阵

| 解决方案              | 设置时间 | 费用   | 实时 | 定制化 | 维护成本 | 最适合               |
| --------------------- | -------- | ------ | ---- | ------ | -------- | -------------------- |
| **原生集成（手动）**  | 10 分钟  | 免费   | 否   | 低     | 无       | 快速设置，小团队     |
| **原生集成（自动）**  | 15 分钟  | $$     | 是   | 低     | 无       | 企业级，自动化工作流 |
| **自定义脚本（API）** | 2-4 小时 | 免费   | 否   | 高     | 中       | 完全控制，批量操作   |
| **Webhooks + 服务**   | 4-8 小时 | 托管费 | 是   | 高     | 高       | 实时，大规模         |
| **Pipedream**         | 30 分钟  | 免费/$ | 是   | 中     | 低       | 无代码，快速原型     |
| **n8n**               | 2-3 小时 | 免费\* | 是   | 高     | 中       | 自托管，数据隐私     |
| **Make.com**          | 1 小时   | 免费/$ | 是   | 高     | 低       | 复杂工作流           |
| **Zapier**            | 30 分钟  | $$     | 是   | 中     | 低       | 商业用户，简单易用   |
| **GitHub Actions**    | 2-3 小时 | 免费   | 否   | 高     | 中       | CI/CD 集成           |

\* 需要托管基础设施

---

## 建议

### 立即使用（本周）

**→ Sentry 原生 GitHub 集成（手动）**

从官方集成开始快速获益：

1. 10 分钟内完成安装
2. 手动测试几个 issues
3. 评估是否值得升级计划以使用自动版本

### 生产使用（长期）

**→ 自定义实现（Sentry API + GitHub API）**

推荐原因：

1. ✅ **已有 @sentry/node 依赖** - 利用现有集成
2. ✅ **完全控制** - 自定义 issue 格式、标签、分配逻辑
3. ✅ **可与 Hive Mind 集成** - 添加到现有自动化套件
4. ✅ **免费** - 无额外订阅费用
5. ✅ **可扩展** - 从简单开始，逐步添加功能
6. ✅ **批量操作** - 可转换现有 issues

**实现计划：**

1. 创建 `scripts/sentry-to-github.mjs` 脚本
2. 使用现有 Sentry 凭据
3. 添加到 npm scripts：`"sentry:sync": "node scripts/sentry-to-github.mjs"`
4. 使用 cron 或 GitHub Actions 定期执行
5. （可选）扩展为基于 webhook 的实时处理

### 实时需求

**→ Sentry Webhooks + 自定义服务**

如果实时性至关重要：

1. 将自定义脚本扩展为 webhook 接收器
2. 作为微服务部署（与 hive-mind 相同的基础设施）
3. 使用现有部署管道

### 无代码快速原型

**→ Pipedream**

如果您想在提交自定义代码前先进行测试：

1. 免费层足以用于测试
2. 以后可以导出/迁移逻辑
3. 有助于理解数据流

---

## 实现注意事项

### 去重

跟踪已同步的 issues 以避免重复：

```javascript
const syncedIssues = new Map(); // sentryId -> githubIssueNumber
```

### 速率限制

- Sentry API：无明确文档限制，但请合理使用
- GitHub API：已认证请求 5,000 次/小时
- 批量操作之间添加延迟

### Issue 状态同步

考虑双向同步：

- Sentry issue 已解决 → 关闭 GitHub issue
- GitHub issue 已关闭 → 更新 Sentry issue 状态

### 标签和分配

- 添加 `sentry` 标签用于过滤
- 解析错误类型以添加额外标签（例如 `TypeError`、`network-error`）
- 使用 Sentry fingerprint/用户数据进行分配

### 错误处理

- 记录失败以便手动审查
- 重试瞬态错误（网络问题）
- 持续失败时发出告警

---

## 后续步骤

1. **立即：** 安装 Sentry GitHub 集成进行手动测试
2. **第 1 周：** 构建自定义脚本以批量转换现有 issues
3. **第 2-3 周：** 添加调度（GitHub Actions 或 cron）
4. **未来：** 如有需要，考虑基于 webhook 的实时同步

---

## 参考资料

### Sentry 文档

- GitHub 集成：https://docs.sentry.io/organization/integrations/source-code-mgmt/github/
- API 参考：https://docs.sentry.io/api/
- 列出 Issues：https://docs.sentry.io/api/events/list-a-projects-issues/
- Webhooks：https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/
- Auth Tokens：https://docs.sentry.io/api/guides/create-auth-token/

### GitHub 文档

- REST API：https://docs.github.com/en/rest
- Octokit.js：https://github.com/octokit/octokit.js
- 创建 Issue：https://docs.github.com/en/rest/issues/issues#create-an-issue

### 第三方平台

- Pipedream：https://pipedream.com/apps/sentry/integrations/github
- n8n：https://n8n.io/integrations/github/and/sentryio/
- Make.com：https://www.make.com/en/integrations/sentry
- Zapier：https://zapier.com

### 社区资源

- Stack Overflow：https://stackoverflow.com/questions/79186277/is-there-a-github-action-to-fetch-sentry-issues-and-create-github-issues
- Sentry GitHub App：https://github.com/apps/sentry-io
