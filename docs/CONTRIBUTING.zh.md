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

1. 当包含 changeset 的 PR 被合并到 main 分支时，发布工作流运行 `changeset version`，并以 `github-actions[bot]` 身份将版本号提升、更新后的 CHANGELOG.md 以及已消耗的 `.changeset/*.md` 文件**直接提交到 main**
2. 同一次运行会将包发布到 NPM 并创建 GitHub release
3. 不会创建 "Version Packages" 或 `release/*` PR：每次发布都会多出一个 PR 和一个无法删除的分支，失败的运行还会留下过期的发布 PR（issue #2402）。如果仓库规则拒绝推送，发布会带着规则的输出失败；应修改规则，而不是添加发布 PR

### 代码不是变更日志

发布历史保存在 `.changeset/*.md`、生成的 `CHANGELOG.md`、GitHub releases、提交信息和代码注释中。用户在运行时读到的一切内容都只描述**软件现在做什么**：`--help` 和用法说明、选项描述、控制台输出、Telegram 机器人回复和 `src/locales/*.lino`，以及工具发布的评论、issue 和提交。

我们不接受以下代码：

- 解释发生了什么变化："旧行为"、"新版本中的默认值"、"现在会做 X"、"不再做 Y"、"旧脚本已升级为命令"、"由……重命名而来"、"vX.Y 新增"、"新功能"横幅或发布说明
- 用引入该行为的 issue 或 PR 标记面向用户的文本，例如 "(issue #1234)"、"(#594)" 或 "Reference: https://github.com/link-assistant/hive-mind/issues/1234"

请描述选项或消息今天的作用。历史写进 changeset，原因写进代码注释，issue 链接写进固定该行为的注释或测试。弃用提示属于当前的指导，因此保留：它们指出替代方案（"deprecated; use `--isolated screen`"），而不讲述变更的经过。诊断日志可以引用记录已知故障的 issue，因为那是排障线索，而不是发布历史。`tests/no-changelog-in-ui-2402.test.mjs` 会对帮助文本、选项描述、本地化文件和发布到 GitHub 的报告执行这一规则。

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

### 测试套件入口

使用 `npm test` 运行默认本地套件。应在默认套件中运行的新测试必须在测试文件本身标记：

```javascript
/**
 * @hive-mind-test-suite default
 */
```

对于需要外部服务或会修改真实仓库的测试，请使用专用套件标记，例如
`github-integration`。不要把单独的 `node tests/...` 命令追加到
`package.json` 或主 CI test-suite job 中。

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
