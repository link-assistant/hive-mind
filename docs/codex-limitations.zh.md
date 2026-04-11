# Codex 工具限制 (languages: [en](codex-limitations.md) • zh • [hi](codex-limitations.hi.md) • [ru](codex-limitations.ru.md))

## 网络限制

Codex 工具出于安全原因运行在具有受限网络访问的沙箱环境中。

### 这意味着什么

1. **无法推送到 GitHub**：Codex 无法直接运行 `git push`
2. **无法获取外部资源**：对外部 API 的访问受限
3. **无法运行网络命令**：`curl`、`wget` 等命令可能失败

### solve.mjs 如何处理这些限制

solve 脚本通过以下方式绕过这些限制：

1. **初始设置**：solve.mjs 克隆仓库并设置分支（在 codex 运行之前）
2. **Codex 执行**：Codex 创建和修改文件，在本地提交
3. **自动重启**：如果 codex 留有未提交的变更，solve.mjs 会自动重启 codex
4. **最终推送**：codex 完成后，solve.mjs 将变更推送到 GitHub（在沙箱外）

### 预期工作流

```
[solve.mjs] Clone repo and create branch
            ↓
[codex]     Make changes and commit locally
            ↓
[solve.mjs] Detect uncommitted changes? → Restart codex
            ↓
[codex]     Commit remaining changes
            ↓
[solve.mjs] Push all commits to GitHub
            ↓
[solve.mjs] Exit successfully
```

### 故障排除

如果在 codex 输出中看到"Could not resolve host: github.com"：

- ✅ 这是预期的正常情况
- ✅ codex 完成后，solve.mjs 将处理推送
- ⚠️ 不要使用 Ctrl+C 中断——让进程完成

如果 codex 完成后 solve.mjs 没有推送：

- 检查是否提前中断了进程
- 手动推送：`git push origin <branch-name>`
- 如果持续失败，请作为 bug 报告

## 自动重启与监视模式

### 自动重启（临时监控）

当 codex 或其他工具留有未提交的变更时，solve.mjs 会自动进入"自动重启模式"：

- **目的**：完成上次运行未完成的工作
- **触发**：工具执行后检测到未提交的变更
- **持续时间**：运行一次，变更提交后退出
- **不同于**：用户请求的 `--watch` 模式

**示例输出：**

```
🔄 AUTO-RESTART: Uncommitted changes detected
   Starting temporary monitoring cycle (NOT --watch mode)
   The tool will run once more to commit the changes
   Will exit automatically after changes are committed

🔄 AUTO-RESTART MODE ACTIVE
   Purpose: Complete unfinished work from previous run
   Monitoring PR: #123
   Mode: Temporary (NOT user-requested --watch)
```

### 监视模式（持续监控）

当您明确使用 `--watch` 时，solve.mjs 会持续监控反馈：

- **目的**：持续监控 PR 上的用户反馈
- **触发**：用户指定 `--watch` 标志
- **持续时间**：无限期运行，直到 PR 被合并或按 Ctrl+C
- **使用场景**：长期运行的反馈监控

**示例输出：**

```
👁️ WATCH MODE ACTIVATED
   Checking interval: 60 seconds
   Monitoring PR: #123
   Stop condition: PR merged by maintainer
```

### 关键区别

| 特性     | 自动重启                         | 监视模式                |
| -------- | -------------------------------- | ----------------------- |
| 激活方式 | 自动（有未提交的变更）           | 手动（`--watch` 标志）  |
| 持续时间 | 单次循环                         | 持续                    |
| 目的     | 完成未完成的工作                 | 监控反馈                |
| 退出条件 | 变更已提交                       | PR 合并或 Ctrl+C        |

## 常见问题

### 问题："Watch mode activated but I didn't use --watch"

**说明**：这是自动重启模式，不是用户请求的监视模式。

**原因**：工具留有需要处理的未提交变更。

**解决方案**：让进程完成。提交变更后会自动退出。

### 问题："Codex can't push to GitHub"

**说明**：Codex 运行在没有网络访问的沙箱环境中。

**原因**：Codex 执行环境中的安全限制。

**解决方案**：Codex 完成后，solve.mjs 会自动推送变更。不要中断进程。

### 问题："Process seems stuck in watch mode"

**说明**：自动重启正在等待变更被提交，或者您使用了 `--watch`。

**调试**：

1. 检查日志消息——是否显示"AUTO-RESTART MODE"或"WATCH MODE ACTIVATED"？
2. 如果是自动重启：检查是否还有未提交的变更
3. 如果是监视模式：您使用了 `--watch` 标志，等待 PR 合并或按 Ctrl+C

**解决方案**：

- 自动重启：让其完成或手动提交变更
- 监视模式：等待完成或使用 Ctrl+C 中断

## 相关文档

- [主 README](../README.md) - 一般用法和功能
- [案例研究：Issue #642](../case-studies/issue-642-codex-watch-mode-and-network/README.md) - 监视模式行为的详细分析
