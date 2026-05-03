# AI 驱动开发的最佳实践 (languages: [en](BEST-PRACTICES.md) • zh • [hi](BEST-PRACTICES.hi.md) • [ru](BEST-PRACTICES.ru.md))

本文档描述了与 Hive Mind 和 AI 驱动开发工作流高效协作的通用最佳实践。涵盖通用提示策略、Issue 编写指南、架构原则以及 CI/CD 标准链接。

## 目录

- [为什么最佳实践很重要](#为什么最佳实践很重要)
- [通用提示词](#通用提示词)
- [编写优质 Issue](#编写优质-issue)
- [架构改进](#架构改进)
- [CI/CD 最佳实践](#cicd-最佳实践)
- [使用子 Agent](#使用子-agent)
- [参考资料](#参考资料)

## 为什么最佳实践很重要

Hive Mind 的质量在很大程度上取决于：

1. **清晰的 Issue 需求** — 模糊的 Issue 产生模糊的解决方案
2. **强大的 CI/CD 流水线** — AI 解决器会迭代直到所有检查通过，从而保证质量
3. **良好的提示** — 通用提示帮助 AI 进行深度分析并避免常见错误
4. **架构纪律** — 一致的代码结构更便于 AI 导航和扩展

这些层次相互叠加：良好的需求 + 强大的 CI/CD + 良好的提示 = 持续优秀的自动化解决方案。

## 通用提示词

以下提示词可以作为评论添加到任何 GitHub Issue 或 Pull Request 中，以指导 AI 解决器的行为。

### 深度分析 Bug 提示词

当 Bug 在尝试修复之前需要彻底调查时使用：

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

### 深度分析功能提示词

当功能请求在实现之前需要研究和设计时使用：

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

### 通用验证提示词

在最终确定任何解决方案之前添加此评论，以确保没有遗漏：

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

### 计划模式提示词

当您希望 AI 在编写任何代码之前提出计划时使用：

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

### 最大能力提示词

在需要充分发挥 AI 能力的复杂 Issue 时使用：

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

## 编写优质 Issue

良好的 Issue 需求是高质量 AI 解决方案的基础。请研究本仓库中已关闭的 Issue 和已合并的 PR，以获取示例。

### Issue 编写清单

- [ ] **清晰的问题陈述** — 什么出错了或缺少了什么？预期行为与实际行为是什么？
- [ ] **复现步骤** — 如何可靠地复现问题？
- [ ] **上下文** — 涉及哪些文件、函数或组件？链接到它们。
- [ ] **验收标准** — 定义"完成"的具体条件是什么？请明确列出。
- [ ] **示例** — 包含代码片段、错误信息或截图作为证据。
- [ ] **约束条件** — 解决方案有哪些不能做的事情（例如不能破坏 X，不能添加依赖项）？
- [ ] **优先级** — 这有多紧急？不修复的影响是什么？

### 本仓库的 Issue 需求模式

基于本仓库中成功解决的 Issue：

**针对 Bug：**

```
## Problem
[一句话描述错误行为]

## Steps to Reproduce
1. [确切的命令或操作]
2. [发生了什么]
3. [应该发生什么]

## Root Cause Hypothesis
[可选：您对原因的最佳猜测]

## Acceptance Criteria
- [ ] [具体可衡量的条件 1]
- [ ] [具体可衡量的条件 2]
- [ ] All CI/CD checks pass
```

**针对功能：**

```
## Goal
[一句话描述新能力]

## Motivation
[为什么需要这个？它解决了什么问题？]

## Proposed Implementation
[可选：您对如何实现的建议]

## Acceptance Criteria
- [ ] [功能在场景 A 中有效]
- [ ] [功能在场景 B 中有效]
- [ ] Tests cover the new behavior
- [ ] Documentation is updated
- [ ] All CI/CD checks pass
```

## 架构改进

要使用 AI 改进代码库的架构，请使用此提示词并参考代码架构原则：

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

### 关键架构原则摘要

有关编写可维护代码的更深入指导，请参阅[代码架构原则](https://github.com/link-foundation/code-architecture-principles)，其中涵盖：

**通用原则：**

- **模块化**：将系统拆分为小型、可测试的部分
- **关注点分离**：高内聚，低耦合
- **抽象**：在稳定接口后隐藏实现细节
- **不可变性**：优先创建新值而非修改
- **快速失败**：在系统边界处验证输入

**主要建议：**

1. 设计易于正确使用且难以误用的 API
2. 暴露功能以实现可扩展性，而非隐藏内部实现
3. 通过深思熟虑的数据建模使无效状态不可能出现
4. 将副作用移至系统边缘；保持核心逻辑纯粹
5. 使用类型系统对有效数据形状建模
6. 编写小型、专注的函数，每个函数只做一件事
7. 优先组合而非继承和复杂性

## CI/CD 最佳实践

CI/CD 流水线是 AI 驱动开发质量的支柱。当检查被强制执行时：

- AI 解决器被**迫使迭代**直到所有测试通过
- **无论是人工还是 AI 编写的代码，质量都能得到保证**
- 问题在到达生产环境之前就被**提前发现**

请参阅 **[CI-CD-BEST-PRACTICES.md](./CI-CD-BEST-PRACTICES.md)** 获取完整指南，包括：

- 仅对相关文件更改运行检查（节省 CI 成本）
- 文件大小限制和快速失败作业排序
- 自动化格式化、代码检查和静态分析
- 基于 Changeset 的版本控制，无合并冲突
- 新鲜合并模拟以验证实际合并结果
- 无需长期 secret 的 OIDC 可信发布

JavaScript、Rust、Python、Go、C# 和 Java 的现成模板均可使用。

## 使用子 Agent

Hive Mind 可以协调多个并行工作的 AI agent。在以下情况下使用子 agent：

### 何时使用子 Agent

- **独立的并行研究** — 一个 agent 搜索日志，另一个读取源代码
- **保护主上下文** — 将大型文件读取或长时间搜索卸载给子 agent
- **专业化任务** — 为文档使用专用 agent，为测试使用另一个
- **交叉验证** — 让多个 agent 独立提出解决方案，然后进行比较

### 子 Agent 模式

**并行研究：**

```
Launch subagents concurrently for:
- Agent 1: Read all source files related to [feature area]
- Agent 2: Search for recent issues and PRs related to this problem
- Agent 3: Read all test files to understand expected behavior
Then synthesize findings before implementing.
```

**分阶段工作：**

```
Stage 1 (research subagent): Collect and analyze all relevant data
Stage 2 (plan subagent): Design the implementation approach
Stage 3 (implementation): Write and test the solution
Stage 4 (validation subagent): Run all checks and verify requirements
```

**清单迭代：**

```
Maintain a checklist of all requirements from the issue.
After each step, check off completed items.
Iterate until the checklist is fully complete and all CI/CD checks pass.
Never mark a task done until it is verified working.
```

## 参考资料

- [代码架构原则](https://github.com/link-foundation/code-architecture-principles)
- [CI/CD 最佳实践](./CI-CD-BEST-PRACTICES.md)
- [贡献指南](./CONTRIBUTING.zh.md)
- [配置选项](./CONFIGURATION.md)
