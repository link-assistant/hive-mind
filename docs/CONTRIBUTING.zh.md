# 为 Hive Mind 做贡献 (languages: [en](CONTRIBUTING.md) • zh • [hi](CONTRIBUTING.hi.md) • [ru](CONTRIBUTING.ru.md))

## 人机协作指南

本项目以 AI 驱动开发为核心，并配以人工监督。请遵循以下实践：

### 开发工作流程

1. **创建 Issue** — 由人类创建包含明确需求的 Issue
2. **AI 处理** — Hive Mind 分析并提出解决方案
3. **人工审查** — 代码审查与架构决策
4. **迭代优化** — 协作改进循环

### 代码规范

- **TypeScript/JavaScript**：需要严格类型检查
- **文件大小**：每个文件最多 1000 行
- **测试**：关键路径 100% 测试覆盖率
- **文档**：机器可读，节省 token

### 使用 Changesets 进行版本管理

本项目使用 [Changesets](https://github.com/changesets/changesets) 来管理版本和变更日志。这消除了多个 PR 同时修改 package.json 中版本号时产生的合并冲突。

#### 添加 Changeset

当您的更改影响到用户时，请添加一个 changeset：

```bash
npm run changeset
```

这将提示您：

1. 选择变更类型（patch/minor/major）
2. 提供变更摘要

changeset 将作为 markdown 文件保存在 `.changeset/` 目录中，并应随您的 PR 一起提交。

#### Changeset 指南

- **Patch**：Bug 修复、文档更新、内部重构
- **Minor**：新功能、非破坏性增强
- **Major**：影响公开 API 的破坏性更改

示例 changeset 摘要：

```markdown
Add support for automatic fork creation with --auto-fork flag
```

#### 发布流程

1. 当包含 changeset 的 PR 被合并到 main 分支时，发布工作流会自动创建一个"Version Packages" PR
2. Version Packages PR 会更新 package.json 版本和 CHANGELOG.md
3. 当 Version Packages PR 被合并时，包将自动发布到 NPM

### AI Agent 配置

```typescript
interface AgentConfig {
  model: 'sonnet' | 'haiku' | 'opus';
  priority: 'low' | 'medium' | 'high' | 'critical';
  specialization?: string[];
}

export const defaultConfig: AgentConfig = {
  model: 'sonnet',
  priority: 'medium',
  specialization: ['code-review', 'issue-solving'],
};
```

### 质量门控

合并前，请确保：

- [ ] 所有测试通过
- [ ] 文件大小限制已执行
- [ ] 类型检查通过
- [ ] 人工审查已完成
- [ ] AI 达成共识（如果是多 agent 模式）

### 通信协议

#### 人类 → AI

```bash
# 清晰、具体的指令
./solve.mjs https://github.com/owner/repo/issues/123 --requirements "Security focus, maintain backward compatibility"
```

#### AI → 人类

```bash
# 包含可操作项的状态报告
echo "🤖 Analysis complete. Requires human decision on breaking changes."
```

## 测试 AI Agent

```typescript
import { testAgent } from './tests/agent-testing.ts';

// 测试 agent 行为
await testAgent({
  scenario: 'complex-issue-solving',
  expectedOutcome: 'pull-request-created',
  timeout: 300000, // 5 分钟
});
```

## 代码审查流程

1. **自动审查** — AI agent 执行初步分析
2. **跨 Agent 验证** — 多个 agent 验证解决方案
3. **人工监督** — 最终架构和安全审查
4. **达成共识** — 通过讨论解决冲突

### 审查清单

- [ ] 算法正确性已验证
- [ ] 安全漏洞已评估
- [ ] 性能影响已考虑
- [ ] 文档完整性
- [ ] 集成测试覆盖率
