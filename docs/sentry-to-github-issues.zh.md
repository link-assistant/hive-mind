# 将 Sentry Issues 转换为 GitHub Issues - 研究报告 (languages: [en](sentry-to-github-issues.md) • zh • [hi](sentry-to-github-issues.hi.md) • [ru](sentry-to-github-issues.ru.md))

## 概述

本文档探讨了为 `link-assistant/hive-mind` 项目自动将 Sentry issues 转换为 GitHub Issues 的所有可用选项。我们的 Sentry 仪表板位于：https://deepassistant.sentry.io/issues

## 当前集成状态

该项目目前已集成 Sentry 进行错误跟踪：

- **Sentry SDK**：`@sentry/node`（v10.15.0）和 `@sentry/profiling-node`（v10.15.0）
- **实现**：位于 `src/sentry.lib.mjs` 的综合 Sentry 库，包含错误跟踪、面包屑和性能监控
- **尚无现有的 GitHub issue 创建自动化**

## 可用选项

### 选项一：Sentry 原生 GitHub 集成（基于 UI）

Sentry 提供可通过 Sentry Web 界面配置的内置 GitHub 集成。

#### 功能：

- **自动创建 Issue**：通过 Alert Rules 自动创建 GitHub issues
- **手动创建 Issue**：从 Sentry UI 创建和关联 GitHub issues
- **双向关联**：将 Sentry issues 关联到现有 GitHub issues/PR
- **代码所有权集成**：同步 CODEOWNERS 文件以自动建议指派人
- **提交跟踪**：当提交中提到 `fixes <SENTRY-SHORT-ID>` 时自动解决 Sentry issues
- **PR 评论**：对疑似导致问题的已合并 PR 自动添加评论

#### 设置：

1. 在 Sentry 中导航到 **Settings > Integrations > GitHub**
2. 安装 GitHub 集成（推荐从 Sentry 安装，而非从 GitHub）
3. 配置 Issue Alerts 以自动创建 GitHub issues
4. 设置带有"Create a new GitHub issue"操作的告警规则

#### 限制：

- **需要手动 UI 配置**告警规则
- **不可以编程方式控制** - 对内置集成的 API 访问有限
- **需要 Business 或 Enterprise 计划**才能自动创建 issue
- **需要 Team 计划或更高**才能手动管理 issues

#### 定价影响：

- 根据当前 Sentry 订阅，可能需要升级计划

---

### 选项二：使用 Sentry API + GitHub API 的自定义脚本

构建一个自定义 Node.js 脚本，定期从 Sentry 获取 issues 并创建对应的 GitHub issues。

#### 实现方法：

**步骤一：获取 Sentry Issues**

```javascript
// Using Sentry REST API v0
const response = await fetch('https://sentry.io/api/0/organizations/{org_slug}/issues/?query=is:unresolved', {
  headers: {
    Authorization: 'Bearer <SENTRY_AUTH_TOKEN>',
  },
});
```

**端点详情：**

- **URL**：`GET /api/0/organizations/{organization_id_or_slug}/issues/`
- **认证**：Bearer token，需要 `event:read` 权限范围
- **查询参数**：
  - `query`：过滤 issues（默认：`is:unresolved issue.priority:[high,medium]`）
  - `statsPeriod`：时间段（`24h`、`7d` 等）
  - `project`：按项目 ID 过滤
  - `sort`：排序顺序（`date`、`new`、`freq`、`user`）
  - `limit`：每次请求最多 100 条

**步骤二：创建 GitHub Issues**

```javascript
// Using GitHub REST API
const response = await fetch('https://api.github.com/repos/{owner}/{repo}/issues', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer <GITHUB_TOKEN>',
    Accept: 'application/vnd.github+json',
  },
  body: JSON.stringify({
    title: sentryIssue.title,
    body: `**Sentry Issue:** ${sentryIssue.permalink}\n\n${sentryIssue.metadata.value}`,
    labels: ['sentry', 'bug'],
  }),
});
```

**步骤三：跟踪已同步的 Issues**

- 存储 Sentry issue ID 和 GitHub issue 编号之间的映射
- 防止重复创建 issue
- 存储选项：
  - 本地 JSON 文件
  - 数据库
  - GitHub issue 标签/元数据
  - Sentry 标签

#### 调度选项：

1. **Cron Job**：定期运行脚本（例如每小时）
2. **GitHub Actions**：使用定期工作流
3. **systemd timer**：用于服务器部署
4. **Docker 容器**：带调度器

#### 优点：

- ✅ 完全控制 issue 格式和内容
- ✅ 无额外服务依赖
- ✅ 可自定义过滤和优先级逻辑
- ✅ 可添加自定义标签、指派人和元数据
- ✅ 适用于任何 Sentry 计划
- ✅ 易于集成到现有代码库

#### 缺点：

- ❌ 需要维护
- ❌ 非实时（取决于轮询间隔）
- ❌ 需要处理两个 API 的速率限制
- ❌ 必须实现状态跟踪以避免重复
- ❌ 需要安全的 token 存储

#### 实现估算：

- **初始开发**：4-6 小时
- **测试与完善**：2-3 小时
- **总计**：6-9 小时

---

### 选项三：基于 Webhook 的 GitHub Actions 自动化

使用 Sentry webhooks 触发 GitHub Actions 工作流，实时创建 issues。

#### 架构：

```
Sentry Issue Event → Webhook → GitHub Actions Workflow → Create GitHub Issue
```

#### 实现步骤：

**步骤一：创建 Sentry 内部集成**

1. 在 Sentry 中进入 **Settings > Developer Settings > Internal Integrations**
2. 创建新的内部集成
3. 订阅 webhook 事件：`issue.created`、`issue.updated`
4. 将 webhook URL 设置为 GitHub Actions webhook 接收器

**步骤二：设置 GitHub Actions Webhook 接收器**

- 使用 repository dispatch 事件或 webhook 代理
- 选项：
  - **Webhook 代理服务**（例如用于开发的 smee.io）
  - **自托管 webhook 接收器**
  - **云函数**（AWS Lambda、Google Cloud Functions）

**步骤三：GitHub Actions 工作流**

```yaml
name: Create GitHub Issue from Sentry
on:
  repository_dispatch:
    types: [sentry-issue]

jobs:
  create-issue:
    runs-on: ubuntu-latest
    steps:
      - name: Create GitHub Issue
        uses: actions/github-script@v7
        with:
          script: |
            const sentryIssue = context.payload.client_payload;
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: sentryIssue.data.issue.title,
              body: `Sentry Issue: ${sentryIssue.data.issue.web_url}`,
              labels: ['sentry', 'automated']
            });
```

#### Webhook 载荷结构：

```json
{
  "action": "created",
  "installation": {
    "uuid": "<installation-uuid>"
  },
  "data": {
    "issue": {
      "id": "<issue-id>",
      "title": "Issue title",
      "web_url": "https://sentry.io/...",
      "project": {...},
      "metadata": {...}
    }
  },
  "actor": {
    "type": "application",
    "id": "sentry",
    "name": "Sentry"
  }
}
```

#### 优点：

- ✅ 实时创建 issue
- ✅ 事件驱动（无需轮询）
- ✅ 使用云函数无需额外基础设施
- ✅ 可扩展
- ✅ 适用于任何 Sentry 计划

#### 缺点：

- ❌ 需要 webhook 端点设置
- ❌ 初始设置更复杂
- ❌ 需要处理 webhook 认证和验证
- ❌ 潜在的 webhook 投递失败需要重试逻辑
- ❌ GitHub Actions 有使用限制

#### 实现估算：

- **初始开发**：6-8 小时
- **测试与部署**：3-4 小时
- **总计**：9-12 小时

---

### 选项四：第三方自动化平台

使用无代码/低代码自动化平台连接 Sentry 和 GitHub。

#### 可用平台：

##### **Pipedream**（推荐用于简单场景）

- **预构建集成**："Create Issue with GitHub API on New Issue Event (Instant) from Sentry API"
- **URL**：https://pipedream.com/apps/sentry/integrations/github
- **功能**：
  - 通过 webhook 获得即时 Sentry issue 事件
  - 预配置 GitHub issue 创建
  - 提供免费层（全天候运行）
  - 源代码可用的组件
  - 使用 Node.js 轻松自定义

**设置时间**：15-30 分钟

##### **n8n**（最适合自托管）

- **集成**：GitHub + Sentry.io 工作流自动化
- **URL**：https://n8n.io/integrations/github/and/sentryio/
- **功能**：
  - 自托管选项（完全数据控制）
  - 可视化工作流构建器
  - 无需编码
  - 灵活的触发器和操作配置
  - 免费且开源

**设置时间**：30-60 分钟（自托管还需加上托管设置时间）

##### **Zapier**

- **状态**：无原生 Sentry 集成（必须使用 webhooks）
- **限制**：需要手动 webhook 配置
- **定价**：高级功能需要付费计划

**不推荐，因为缺乏原生支持**

##### **Make**（原 Integromat）

- **集成**：可用但需要手动设置
- **功能**：可视化工作流设计
- **定价**：提供免费层，但有限制

**设置时间**：45-60 分钟

#### 对比矩阵：

| 平台      | 设置时间   | 费用        | 自托管 | 易用性     | 推荐程度              |
| --------- | ---------- | ----------- | ------ | ---------- | --------------------- |
| Pipedream | 15-30 分钟 | 免费层      | 否     | ⭐⭐⭐⭐⭐ | ✅ 最适合快速设置     |
| n8n       | 30-60 分钟 | 免费（OSS） | 是     | ⭐⭐⭐⭐   | ✅ 最适合数据隐私     |
| Make      | 45-60 分钟 | 付费        | 否     | ⭐⭐⭐⭐   | ⚠️ 如果已在使用则考虑 |
| Zapier    | 60+ 分钟   | 付费        | 否     | ⭐⭐⭐     | ❌ 不推荐             |

#### 优点：

- ✅ 部署时间最快（尤其是 Pipedream）
- ✅ 无需代码或极少代码
- ✅ 内置错误处理和重试逻辑
- ✅ 可视化工作流管理
- ✅ 易于修改和测试
- ✅ 提供免费层

#### 缺点：

- ❌ 依赖外部服务
- ❌ 免费层可能有使用限制
- ❌ 对实现细节的控制较少
- ❌ 供应商锁定（n8n 除外）
- ❌ 数据流经第三方服务器（自托管 n8n 除外）

---

## 推荐方法

### 立即实施：**Pipedream**

**理由：**

1. ✅ 设置最快（15-30 分钟）
2. ✅ 预构建集成，随时可用
3. ✅ 免费层满足大多数使用场景
4. ✅ 无需维护基础设施
5. ✅ 易于测试和迭代

**设置步骤：**

1. 注册 Pipedream 账户
2. 导航到 https://pipedream.com/apps/sentry/integrations/github
3. 点击"Create Issue with GitHub API on New Issue Event (Instant) from Sentry API"
4. 连接 Sentry 账户（将自动创建 webhook）
5. 连接 GitHub 账户
6. 配置仓库和 issue 模板
7. 测试并部署

### 长期灵活性：**自定义脚本（选项二）**

**理由：**

1. ✅ 完全控制和自定义
2. ✅ 无外部依赖
3. ✅ 可与现有代码库集成
4. ✅ 易于扩展其他功能
5. ✅ 无供应商锁定

**实现路径：**

1. 在 `scripts/sentry-to-github.mjs` 中创建脚本
2. 添加 issue 映射规则的配置文件
3. 实现用于调度的 GitHub Actions 工作流
4. 添加状态跟踪（JSON 文件或 GitHub 标签）
5. 添加全面的错误处理和日志记录
6. 记录使用方法和配置

**示例文件结构：**

```
scripts/
  sentry-to-github.mjs          # Main script
  sentry-github-config.json     # Configuration
  sentry-sync-state.json        # State tracking (gitignored)
.github/
  workflows/
    sentry-sync.yml             # Scheduled workflow
```

### 企业级/隐私需求：**自托管 n8n**

**理由：**

1. ✅ 完全数据控制（自托管）
2. ✅ 可视化工作流管理
3. ✅ 无外部数据共享
4. ✅ 免费且开源
5. ✅ 可通过自定义节点扩展

---

## 实施路线图

### 第一阶段：快速见效（1-2 天）

1. 设置 Pipedream 集成，实现即时 issue 同步
2. 用部分 Sentry issues 进行测试
3. 完善 GitHub issue 模板和标签
4. 记录流程

### 第二阶段：自定义解决方案（1-2 周）

1. 开发具有完整功能集的自定义脚本
2. 实现全面的状态跟踪
3. 添加过滤规则（优先级、项目等）
4. 设置 GitHub Actions 调度
5. 添加监控和告警
6. 从 Pipedream 迁移到自定义解决方案

### 第三阶段：优化（持续进行）

1. 添加基于 ML 的 issue 去重
2. 根据堆栈跟踪实现自动指派人检测
3. 添加 issue 生命周期管理（Sentry issue 解决时自动关闭）
4. 创建同步统计仪表板
5. 添加双向同步支持

---

## API 参考

### Sentry API

**列出组织 Issues：**

```
GET https://sentry.io/api/0/organizations/{org_slug}/issues/
Authorization: Bearer <token>
```

**查询参数：**

- `query`：过滤查询（例如 `is:unresolved issue.priority:high`）
- `statsPeriod`：时间段（`24h`、`7d`、`14d`）
- `project`：要过滤的项目 ID
- `sort`：排序顺序（`date`、`new`、`freq`、`user`）
- `limit`：最多 100 条结果

**响应：**

```json
[
  {
    "id": "issue-id",
    "title": "Error title",
    "permalink": "https://sentry.io/organizations/.../issues/...",
    "project": {
      "name": "Project Name",
      "slug": "project-slug"
    },
    "status": "unresolved",
    "level": "error",
    "count": 42,
    "userCount": 10,
    "firstSeen": "2025-10-01T00:00:00Z",
    "lastSeen": "2025-10-01T12:00:00Z"
  }
]
```

### GitHub API

**创建 Issue：**

```
POST https://api.github.com/repos/{owner}/{repo}/issues
Authorization: Bearer <token>
Accept: application/vnd.github+json
```

**请求体：**

```json
{
  "title": "Issue title",
  "body": "Issue description with Sentry link",
  "labels": ["bug", "sentry"],
  "assignees": ["username"]
}
```

**响应：**

```json
{
  "id": 123,
  "number": 456,
  "state": "open",
  "title": "Issue title",
  "html_url": "https://github.com/owner/repo/issues/456"
}
```

---

## 安全注意事项

### 认证 Token

1. **Sentry Auth Token**：使用最小权限范围创建（`event:read`）
2. **GitHub Token**：使用具有 `issues:write` 权限的细粒度 PAT
3. **存储**：使用环境变量或安全密钥管理
4. **轮换**：实施 token 轮换策略

### Webhook 安全

1. **签名验证**：验证来自 Sentry 的 webhook 签名
2. **仅限 HTTPS**：webhook 端点始终使用 HTTPS
3. **IP 允许列表**：如果可能，将 webhook 来源限制为 Sentry IP
4. **速率限制**：在 webhook 端点实施速率限制

### 数据隐私

1. **PII 处理**：注意包含敏感数据的堆栈跟踪
2. **错误消息**：在创建 GitHub issues 前对错误消息进行脱敏
3. **访问控制**：确保 GitHub 仓库具有适当的访问限制
4. **合规性**：考虑错误数据的 GDPR/隐私要求

---

## 成本分析

### 选项一：Sentry 原生集成

- **费用**：取决于 Sentry 计划（可能需要升级）
- **Business 计划**：起价 $80/月
- **设置**：免费
- **维护**：极少

### 选项二：自定义脚本

- **开发**：6-9 小时（一次性）
- **基础设施**：免费（使用 GitHub Actions）
- **维护**：约 2-4 小时/月
- **第一年总计**：约 $0（假设内部开发）

### 选项三：Webhook + GitHub Actions

- **开发**：9-12 小时（一次性）
- **基础设施**：免费（在 GitHub Actions 限制内）
- **维护**：约 1-2 小时/月
- **第一年总计**：约 $0（假设内部开发）

### 选项四：第三方平台

**Pipedream：**

- **免费层**：100K credits/月（满足大多数使用场景）
- **付费层**：$19/月，1M credits
- **设置**：免费
- **维护**：极少

**n8n（云端）：**

- **Starter**：$20/月
- **Pro**：$50/月

**n8n（自托管）：**

- **软件**：免费（开源）
- **基础设施**：约 $5-20/月（小型 VPS）
- **设置**：2-4 小时
- **维护**：约 2-3 小时/月

---

## 监控与维护

### 需要跟踪的关键指标

1. **同步成功率**：Sentry issues 成功转换的百分比
2. **同步延迟**：Sentry issue 创建到 GitHub issue 创建之间的时间
3. **重复率**：创建的重复 issues 百分比
4. **API 速率限制**：监控 Sentry 和 GitHub API 使用情况
5. **错误率**：因 API 错误或验证问题导致的同步失败

### 推荐的监控工具

1. **日志记录**：使用结构化日志（JSON 格式）
2. **告警**：为同步失败设置告警
3. **仪表板**：创建同步健康状态仪表板
4. **指标**：使用现有 Sentry 集成跟踪脚本本身的指标

---

## 结论

对于 `hive-mind` 项目，我们推荐**两阶段方法**：

1. **立即（第 1 周）**：部署 **Pipedream** 集成以快速获益
   - 立即从自动 issue 创建中获得价值
   - 验证工作流和 issue 格式
   - 收集团队反馈

2. **长期（第 1-2 个月）**：开发**自定义脚本**以获得完全控制
   - 构建具有高级功能的定制解决方案
   - 与现有代码库深度集成
   - 消除外部依赖
   - 从 Pipedream 迁移

这种方法在快速获得价值与长期可持续性和控制之间取得平衡。

---

## 后续步骤

1. ✅ 与团队一起审阅本文档
2. ⬜ 确定方法（推荐：Pipedream → 自定义脚本）
3. ⬜ 如果选择 Pipedream：设置集成并测试（预计耗时：1 小时）
4. ⬜ 如果选择自定义脚本：制定实施计划（预计耗时：1 天）
5. ⬜ 在项目 README 中记录最终解决方案
6. ⬜ 设置监控和告警
7. ⬜ 安排定期审查同步效果

---

## 参考资料

- [Sentry GitHub 集成文档](https://docs.sentry.io/organization/integrations/source-code-mgmt/github/)
- [Sentry API 参考](https://docs.sentry.io/api/)
- [Sentry Webhooks 文档](https://docs.sentry.io/organization/integrations/integration-platform/webhooks/)
- [GitHub REST API - Issues](https://docs.github.com/en/rest/issues/issues)
- [Pipedream Sentry-GitHub 集成](https://pipedream.com/apps/sentry/integrations/github)
- [n8n Sentry 集成](https://n8n.io/integrations/sentryio/)
- [Sentry 集成平台](https://docs.sentry.io/organization/integrations/integration-platform/)

---

_报告生成时间：2025-10-01_
_作者：AI Issue Solver_
_Issue：#357_
