# Issue #94 解决方案总结：Claude 命令被终止 (languages: [en](issue-94-claude-command-kills-solution.md) • zh • [hi](issue-94-claude-command-kills-solution.hi.md) • [ru](issue-94-claude-command-kills-solution.ru.md))

## 所做的变更

### 1. **Claude 执行前的内存检查**

- 添加了从 `/proc/meminfo` 检查可用内存的 `checkMemory()` 函数
- 在启动 Claude 前检查可用内存是否至少有 256MB
- 如果内存不足，提供有用的 Ubuntu 24.04 增加 swap 的说明
- 在进程早期调用，以防止在内存过低时启动 Claude

### 2. **系统资源监控**

- 添加了 `getResourceSnapshot()` 函数以捕获系统状态
- 在 Claude 执行前和失败时获取资源快照
- 记录内存、CPU 负载和系统运行时间信息
- 帮助诊断 Claude 被终止的原因

### 3. **改进进程终止检测**

- 增强了 stderr 监控以检测终止信号（SIGKILL、SIGTERM 等）
- 添加了内存相关终止的特定检测（OOM、"killed"等）
- 提供详细的退出码说明：
  - 退出码 137：SIGKILL（可能是内存限制）
  - 退出码 139：SIGSEGV（段错误）
  - 退出码 143：SIGTERM（被终止）

### 4. **使用 Sonnet 模型进行 Claude CLI 连接检查**

- 更新了 `solve.mjs` 和 `hive.mjs`，使用 `--model sonnet` 进行连接检查
- 确保连接测试使用最便宜的模型，而不是可能昂贵的默认模型
- 对所有三个连接检查命令进行了更改：
  - `printf hi | claude --model sonnet -p`
  - `timeout 60 claude --model sonnet -p hi`
  - 更新错误消息，建议使用 `claude --model sonnet -p hi`

### 5. **增强的错误处理和日志记录**

- Claude 命令失败时更好的资源监控
- 改进了带有特定终止检测的错误消息
- 当使用 `--attach-logs` 时增强了失败的日志附件
- 命令失败时将失败日志添加到 PR 评论

### 6. **正确的错误码**

- 确保在所有失败场景中调用 `process.exit(1)`
- 在主 catch 块中添加了正确的错误码处理
- 在整个系统中维护干净的错误传播

## 根本原因分析

问题由以下原因引起：

1. **内存不足**：系统只有约 56MB 可用内存，而 Claude 需要 256MB+
2. **swap 不足**：总 swap 只有 512MB，且大部分已使用
3. **无早期内存检查**：Claude 会启动然后被 OOM killer 终止
4. **昂贵的连接检查**：使用默认模型进行连接测试

## 测试

该解决方案已通过以下测试：

- 各种阈值下的内存检查功能
- 资源快照收集
- 错误检测模式
- 低内存场景模拟

## 修复后的预期行为

1. **早期检测**：在 Claude 启动前检测到内存问题
2. **清晰说明**：用户获得特定的 Ubuntu 24.04 增加 swap 命令
3. **更好的诊断**：当 Claude 被终止时，用户能看到资源状态和可能的原因
4. **成本优化**：连接检查使用最便宜的 sonnet 模型
5. **正确的失败处理**：失败返回适当的退出码并附上日志

该解决方案解决了 GitHub issue 中提到的所有方面，同时保持了向后兼容性，并改善了遇到资源限制时的整体用户体验。
