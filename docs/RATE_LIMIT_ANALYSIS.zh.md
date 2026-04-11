# GitHub API 速率限制错误分析 (languages: [en](RATE_LIMIT_ANALYSIS.md) • zh • [hi](RATE_LIMIT_ANALYSIS.hi.md) • [ru](RATE_LIMIT_ANALYSIS.ru.md))

## Issue 背景

**GitHub Issue**：[#186](https://github.com/link-assistant/hive-mind/issues/186)
**问题**：搜索 API 触达速率限制，需要回退到仓库列表 API
**目标**：实现速率限制错误的正确检测和回退机制

## 关键发现

### 1. 速率限制错误模式

当 GitHub CLI（`gh`）命令触达速率限制时，会产生可以检测的特定错误消息：

#### 主要速率限制错误

```
HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID D84A:2DE4CB:565BC8C:5079198:68CB676D. (https://api.github.com/search/issues?advanced_search=true&page=3&per_page=100&q=is%3Aissue+type%3Aissue)
```

#### 检测模式

要检测速率限制错误，请在错误消息中检查以下模式：

- `"rate limit"`（不区分大小写）
- `"secondary rate limit"`
- `"HTTP 403"` 结合速率相关术语
- `"exceeded.*limit"`（正则表达式模式）
- `"Please wait"` 或 `"wait a few minutes"`
- `"abuse detection"`（GitHub 的滥用检测机制）
- `"too many requests"`

### 2. API 行为差异

#### 搜索 API（`gh search issues`）

- **速率限制**：每分钟 30 次请求
- **次要速率限制**：由大页面大小（>100）或快速请求触发
- **页面大小限制**：实际最大约 100-200 项
- **行为**：限制更严格，更容易触达速率限制
- **使用场景**：跨仓库搜索、组织/用户范围

#### 仓库列表 API（`gh issue list --repo`）

- **速率限制**：高于搜索 API
- **次要速率限制**：不太容易触发
- **页面大小限制**：可以成功处理 1000+ 项
- **行为**：更可靠，更适合大数据集
- **使用场景**：单个仓库、回退策略

### 3. 最大页面大小

| API 类型       | 推荐最大值 | 测试最大值 | 备注                                          |
| -------------- | ----------- | ---------- | --------------------------------------------- |
| 搜索 API       | 100         | 200        | 较高的值会触发次要速率限制                    |
| 仓库 API       | 1000        | 1000+      | 大页面大小时更可靠                            |
| PR 列表        | 1000        | 1000+      | 与仓库 API 类似                               |

### 4. 速率限制响应头

GitHub API 响应在响应头中包含速率限制信息：

```
X-Ratelimit-Limit: 30
X-Ratelimit-Remaining: 18
X-Ratelimit-Reset: 1758160590
X-Ratelimit-Resource: search
X-Ratelimit-Used: 12
```

## 实现策略

### 当前实现

代码库在 `/tmp/gh-issue-solver-1758160335449/github.lib.mjs` 中已有 `fetchAllIssuesWithPagination()` 函数，该函数：

- 使用 `execSync` 执行 GitHub CLI 命令
- 以改进的限制（1000）实现分页
- 在请求之间添加延迟（5 秒）
- 具有基本的错误处理

### 所需改进

1. **添加速率限制检测函数**

```javascript
function isRateLimitError(error) {
  const errorText = (error.stderr?.toString() || error.stdout?.toString() || error.message || '').toLowerCase();

  const rateLimitPatterns = [/rate limit/i, /secondary rate limit/i, /exceeded.*limit/i, /abuse detection/i, /too many requests/i, /please wait.*before/i, /wait.*(?:few )?minutes?/i, /http 403.*(?:rate|limit|abuse)/i];

  return rateLimitPatterns.some(pattern => pattern.test(errorText));
}
```

2. **实现回退策略**

```javascript
// In fetchAllIssuesWithPagination
try {
  const output = execSync(searchCommand, { encoding: 'utf8' });
  // ... process success
} catch (error) {
  if (isRateLimitError(error)) {
    await log('🚨 Rate limit detected, falling back to repository listing API');
    return await fallbackToRepositoryListing(baseCommand);
  } else {
    // Handle other errors
    throw error;
  }
}
```

3. **更新页面大小策略**

- 搜索 API：每次请求最多 100 项
- 仓库 API：每次请求最多 1000 项
- 保持现有的请求间 5 秒延迟

### 回退逻辑

当搜索 API 触达速率限制时：

1. 使用上述模式检测速率限制错误
2. 解析原始命令以提取仓库信息
3. 将搜索命令转换为仓库列表命令
4. 对仓库 API 使用更高的页面限制（1000）
5. 以与搜索 API 相同的格式返回结果

### 示例命令转换

| 原始命令（搜索 API）                        | 回退命令（仓库 API）                                       |
| ------------------------------------------ | --------------------------------------------------------- |
| `gh search issues org:microsoft is:open`   | 多次 `gh issue list --repo {repo} --state open` 调用      |
| `gh search issues user:username is:open`   | 多次 `gh issue list --repo {repo} --state open` 调用      |
| `gh search issues repo:owner/repo is:open` | `gh issue list --repo owner/repo --state open`            |

## 需要修改的文件

### 1. `/tmp/gh-issue-solver-1758160335449/github.lib.mjs`

- 更新 `fetchAllIssuesWithPagination()` 函数
- 添加速率限制检测
- 实现回退逻辑
- 根据 API 类型优化页面大小

### 2. 调用点

- `/tmp/gh-issue-solver-1758160335449/hive.mjs`（第 585、598、629 行）
- 其他调用 `fetchAllIssuesWithPagination()` 的文件

## 测试策略

1. **速率限制检测**：通过故意触发速率限制进行测试
2. **回退机制**：验证搜索失败时仓库 API 是否正常工作
3. **页面大小优化**：测试每个 API 的不同限制
4. **错误处理**：确保优雅降级

## 优势

1. **提高可靠性**：回退确保仍然可以获取 issue
2. **更好的性能**：为每个 API 使用最佳页面大小
3. **速率限制感知**：正确的检测和处理
4. **用户体验**：优雅降级而非失败

## 后续步骤

1. 在 `fetchAllIssuesWithPagination()` 中实现速率限制检测
2. 添加到仓库列表 API 的回退
3. 使用各种速率限制场景进行测试
4. 更新页面大小建议
5. 监控和记录速率限制事件以供未来优化
