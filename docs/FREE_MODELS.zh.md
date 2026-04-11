# Hive-Mind 中的免费模型支持 (languages: [en](FREE_MODELS.md) • zh • [hi](FREE_MODELS.hi.md) • [ru](FREE_MODELS.ru.md))

本文档提供了有关 hive-mind 在使用 `--tool agent` 选项时支持的免费模型的全面信息。

> **最后更新：** 2026 年 4 月 10 日
> **相关内容：**
>
> - [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) - 上游免费模型列表（权威来源）
> - [Agent PR #243](https://github.com/link-assistant/agent/pull/243) - 上游：将已弃用的 qwen3.6-plus-free 替换为 nemotron-3-super-free 作为默认模型
> - [Agent PR #234](https://github.com/link-assistant/agent/pull/234) - 上游：qwen3.6-plus-free 作为默认模型，添加 nemotron-3-super-free
> - [Agent PR #209](https://github.com/link-assistant/agent/pull/209) - 上游免费模型更新（minimax-m2.5-free 作为默认模型）
> - [Agent Issue #208](https://github.com/link-assistant/agent/issues/208) - kimi-k2.5-free 从 OpenCode Zen 移除

## 可用免费模型

Hive-mind 支持来自两个提供商的免费模型：

1. **OpenCode Zen** - 4 个免费模型，使用 `opencode/` 前缀
2. **Kilo Gateway** - 6 个免费模型，使用 `kilo/` 前缀（Issue #1282）

---

## OpenCode Zen 免费模型

### 1. opencode/nemotron-3-super-free **默认模型**

- **短别名**：`nemotron-3-super-free`
- **提供商**：OpenCode Zen
- **状态**：完全支持（自 Issue #1563 起为 `--tool agent` 的默认模型）
- **功能**：推理、工具调用、混合 Mamba-Transformer 架构
- **上下文窗口**：约 262,144 个 token
- **输出限制**：262,144 个 token
- **费用**：免费（无输入/输出收费）
- **知识截止日期**：2025 年 1 月
- **发布日期**：2026 年 3 月
- **开放权重**：是
- **备注**：NVIDIA 混合 Mamba-Transformer MoE，强大的推理能力

### 2. opencode/minimax-m2.5-free

- **短别名**：`minimax-m2.5-free`
- **提供商**：OpenCode Zen
- **状态**：完全支持（前默认模型，Issue #1391、#1543）
- **功能**：推理、工具调用、温度控制
- **上下文窗口**：204,800 个 token
- **输出限制**：131,072 个 token
- **费用**：免费（无输入/输出收费）
- **知识截止日期**：2025 年 1 月
- **发布日期**：2026 年 2 月
- **开放权重**：是

### 3. opencode/gpt-5-nano

- **短别名**：`gpt-5-nano`
- **提供商**：OpenCode Zen
- **状态**：完全支持
- **功能**：推理、工具调用、结构化输出、温度控制
- **上下文窗口**：约 400,000 个 token
- **输出限制**：128,000 个 token
- **费用**：免费（无输入/输出收费）
- **知识截止日期**：2025 年 1 月

### 4. opencode/big-pickle

- **短别名**：`big-pickle`
- **提供商**：OpenCode Zen
- **状态**：完全支持
- **功能**：推理、工具调用、温度控制
- **上下文窗口**：约 200,000 个 token
- **输出限制**：128,000 个 token
- **费用**：免费（无输入/输出收费）
- **知识截止日期**：2025 年 1 月

---

## 已停用的 OpenCode Zen 免费模型

以下模型之前是免费的，但现已不再可用：

| 模型               | 原模型 ID                    | 状态                                                                                                                                      |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen 3.6 Plus Free | `opencode/qwen3.6-plus-free` | 免费推广已结束（2026 年 4 月）— 现需要 OpenCode Go 订阅。参见 [agent#242](https://github.com/link-assistant/agent/issues/242)             |
| Kimi K2.5 Free     | `opencode/kimi-k2.5-free`    | 已从 OpenCode Zen 移除（2026 年 3 月）— 参见 [agent#208](https://github.com/link-assistant/agent/issues/208)                             |
| Grok Code Fast 1   | `opencode/grok-code`         | 2026 年 1 月停用                                                                                                                          |
| MiniMax M2.1 Free  | `opencode/minimax-m2.1-free` | 已被 `opencode/minimax-m2.5-free` 替代                                                                                                    |
| GLM 4.7 Free       | `opencode/glm-4.7-free`      | 在 OpenCode Zen 上不再免费                                                                                                                |

> **注意：** 请参阅 [OpenCode Zen 文档](https://opencode.ai/docs/zen/) 和 [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) 获取当前的免费模型列表。

---

## Kilo Gateway 免费模型

[Kilo Gateway](https://kilo.ai) 通过兼容 OpenAI 的 API 提供对 500+ AI 模型的访问。以下免费模型无需 API 密钥配置即可使用。

> **注意：** Kilo 独家模型（仅在 Kilo Gateway 上可用的模型）支持不带 `kilo/` 前缀的短别名。例如，由于 `glm-5-free` 是 Kilo 独有的，您可以使用 `glm-5-free` 代替 `kilo/glm-5-free`。

### 1. kilo/glm-5-free **Kilo 推荐模型**

- **模型 ID**：`kilo/glm-5-free`
- **短别名**：`glm-5-free`（Kilo 独家模型）
- **提供商**：Kilo Gateway (Z.AI)
- **状态**：完全支持（限时免费）
- **功能**：深度推理、快速推断、双语（中文/英文）、工具调用、结构化输出
- **上下文窗口**：202,752 个 token
- **输出限制**：131,072 个 token
- **费用**：免费（限时优惠）
- **发布日期**：2026 年 2 月 11 日
- **特殊功能**："在许多任务上媲美 Opus 4.5" - [Kilo Blog](https://blog.kilo.ai/p/glm-5-free-limited-time)

### 2. kilo/glm-4.5-air-free

- **模型 ID**：`kilo/glm-4.5-air-free`
- **短别名**：`glm-4.5-air-free`（Kilo 独家模型）
- **提供商**：Kilo Gateway (Z.AI)
- **状态**：完全支持
- **功能**：以代理为中心、轻量级、快速推断
- **上下文窗口**：131,072 个 token
- **输出限制**：65,536 个 token
- **费用**：免费

### 3. kilo/minimax-m2.5-free

- **模型 ID**：`kilo/minimax-m2.5-free`
- **提供商**：Kilo Gateway (MiniMax)
- **状态**：完全支持（从 M2.1 升级）
- **功能**：强大的通用性能
- **上下文窗口**：204,800 个 token
- **输出限制**：131,072 个 token
- **费用**：免费

### 4. kilo/deepseek-r1-free

- **模型 ID**：`kilo/deepseek-r1-free`
- **短别名**：`deepseek-r1-free`（Kilo 独家模型）
- **提供商**：Kilo Gateway (DeepSeek)
- **状态**：完全支持
- **功能**：高级推理、开源、完全开放的推理 token
- **上下文窗口**：163,840 个 token
- **输出限制**：65,536 个 token
- **费用**：免费

### 5. kilo/giga-potato-free

- **模型 ID**：`kilo/giga-potato-free`
- **短别名**：`giga-potato-free`（Kilo 独家模型）
- **提供商**：Kilo Gateway
- **状态**：完全支持（评估期）
- **功能**：通用评估模型
- **上下文窗口**：256,000 个 token
- **输出限制**：131,072 个 token
- **费用**：免费（评估期间）

### 6. kilo/trinity-large-preview

- **模型 ID**：`kilo/trinity-large-preview`
- **短别名**：`trinity-large-preview`（Kilo 独家模型）
- **提供商**：Kilo Gateway (Arcee AI)
- **状态**：完全支持（预览版）
- **功能**：强大能力，预览模型
- **上下文窗口**：131,000 个 token
- **输出限制**：65,536 个 token
- **费用**：免费（预览版）

---

---

## 已停用的 Kilo Gateway 免费模型

以下 Kilo 模型之前是推荐的免费模型，但现已更新：

| 模型         | 原模型 ID                | 状态                                   |
| ------------ | ------------------------ | -------------------------------------- |
| GLM 4.7      | `kilo/glm-4.7-free`      | 已被 `kilo/glm-4.5-air-free` 替代      |
| Kimi K2.5    | `kilo/kimi-k2.5-free`    | 已被其他 Kilo 免费模型替代             |
| MiniMax M2.1 | `kilo/minimax-m2.1-free` | 已被 `kilo/minimax-m2.5-free` 替代     |

> **注意：** 请参阅 [Kilo 免费模型文档](https://kilo.ai/docs/advanced-usage/free-and-budget-models) 了解当前可用情况。

---

## 使用示例

### 命令行用法

```bash
# OpenCode Zen 模型（不带前缀的短别名）
solve https://github.com/owner/repo/issues/123 --tool agent --model nemotron-3-super-free
hive https://github.com/owner/repo --tool agent --model minimax-m2.5-free

# OpenCode Zen 模型（完整模型 ID）
solve https://github.com/owner/repo/issues/123 --tool agent --model opencode/nemotron-3-super-free
hive https://github.com/owner/repo --tool agent --model opencode/big-pickle

# Kilo Gateway 模型（完整模型 ID）
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
hive https://github.com/owner/repo --tool agent --model kilo/deepseek-r1-free

# Kilo 独家模型（不带 kilo/ 前缀的短别名）
solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
hive https://github.com/owner/repo --tool agent --model deepseek-r1-free
```

### Telegram Bot 用法

```bash
# OpenCode Zen 模型（短别名）
/solve https://github.com/owner/repo/issues/123 --tool agent --model nemotron-3-super-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model minimax-m2.5-free

# Kilo Gateway 模型（完整模型 ID）
/solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
/hive https://github.com/owner/repo --tool agent --model kilo/glm-4.5-air-free

# Kilo 独家模型（不带 kilo/ 前缀的短别名）
/solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
/hive https://github.com/owner/repo --tool agent --model glm-4.5-air-free

# 默认模型（通过 OpenCode Zen 的 nemotron-3-super-free）：
/solve https://github.com/owner/repo/issues/123 --tool agent
```

### 直接使用 Agent CLI

```bash
# OpenCode Zen 模型
echo "Your prompt here" | agent --model opencode/nemotron-3-super-free
echo "Your prompt here" | agent --model opencode/minimax-m2.5-free

# Kilo Gateway 模型
echo "Your prompt here" | agent --model kilo/glm-5-free
echo "Your prompt here" | agent --model kilo/deepseek-r1-free
```

---

## 模型选择指南

### 按不同使用场景

**旗舰免费模型**：

- `opencode/nemotron-3-super-free` - NVIDIA 混合 Mamba-Transformer，强大的推理能力（OpenCode，默认）
- `kilo/glm-5-free` - Z.AI 旗舰，在许多任务上媲美 Opus 4.5（Kilo）

**通用与推理**：

- `opencode/gpt-5-nano` - 强大的通用推理能力
- `opencode/big-pickle` - 均衡的性能
- `kilo/minimax-m2.5-free` - 强大的通用性能
- `kilo/deepseek-r1-free` - 高级推理模型

**大上下文任务**：

- `opencode/gpt-5-nano` - 超大上下文（约 400,000 个 token）
- `opencode/nemotron-3-super-free` - 大上下文（约 262,144 个 token）
- `kilo/giga-potato-free` - 大上下文（256,000 个 token）
- `opencode/minimax-m2.5-free` - 大上下文（204,800 个 token）

**以代理为中心 / 编程**：

- `kilo/glm-4.5-air-free` - 专为以代理为中心的应用程序构建
- `kilo/deepseek-r1-free` - 针对推理和代码合成优化
- `opencode/minimax-m2.5-free` - 强大的编程性能

---

## 提供商比较

| 功能         | OpenCode Zen                          | Kilo Gateway             |
| ------------ | ------------------------------------- | ------------------------ |
| 免费模型     | 4 个模型                              | 6 个模型                 |
| 默认模型     | nemotron-3-super-free（约 262K 上下文）| glm-5-free（推荐）       |
| API 格式     | 兼容 OpenAI                           | 兼容 OpenAI              |
| 免费 API 密钥 | `public`                             | `public`                 |
| 总模型数     | 50+                                   | 500+                     |
| 旗舰免费模型 | Nemotron 3 Super（约 262K 上下文）    | GLM-5（限时）            |
| BYOK 支持    | 是                                    | 是                       |
| 新模型       | Nemotron 3 Super（Issue #1543、#1563）| DeepSeek R1、GLM 4.5 Air |

---

## 测试与验证

所有免费模型已通过以下方面的测试和验证：

1. **模型配置**：所有模型在 `src/models/index.mjs` 中正确配置
2. **CLI 集成**：所有模型均被 hive-mind 和 agent CLI 接受
3. **工具兼容性**：所有模型均与 `--tool agent` 选项兼容
4. **大小写不敏感用法**：模型可以任意大小写指定（例如 `KILO/GLM-5-FREE`）
5. **别名支持**：所有模型的短别名均有效

---

## 错误处理

如果遇到任何模型的问题：

1. **检查模型拼写**：确保使用确切的模型名称或别名
2. **更新依赖项**：运行 `npm install` 以确保使用最新的 agent CLI
3. **检查网络**：某些模型可能需要首次设置的互联网访问
4. **验证提供商**：确保使用正确的提供商前缀（`opencode/` 或 `kilo/`）

---

## 相关文档

- [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) - 权威的上游免费模型列表
- [模型模块](../src/models/index.mjs) - 统一的模型数据、验证、映射和信息
- [Agent CLI 文档](https://github.com/link-assistant/agent) - 直接使用 agent CLI
- [Agent Kilo 文档](https://github.com/link-assistant/agent/blob/main/docs/kilo.md) - Kilo Gateway 详情
- [案例研究：Issue #1282](./case-studies/issue-1282/README.md) - Kilo 模型集成分析
- [案例研究：Issue #1300](./case-studies/issue-1300/README.md) - 免费模型更新（MiniMax M2.5、DeepSeek R1）
- [案例研究：Issue #1391](./case-studies/issue-1391/README.md) - 免费模型更新（minimax-m2.5-free 作为默认，kimi-k2.5-free 弃用）
- [案例研究：Issue #1473](./case-studies/issue-1473/README.md) - 模型识别修复和免费模型同步
- [案例研究：Issue #1543](./case-studies/issue-1543/README.md) - 免费模型更新（qwen3.6-plus-free 作为默认，添加 nemotron-3-super-free）
- [案例研究：Issue #1563](./case-studies/issue-1563/README.md) - 免费模型更新（qwen3.6-plus-free 弃用，nemotron-3-super-free 作为默认）
- [OpenCode Zen 文档](https://opencode.ai/docs/zen/) - OpenCode Zen 提供商详情
- [Kilo Gateway 文档](https://kilo.ai/docs/gateway) - Kilo Gateway 提供商详情

---

**最后更新**：2026 年 4 月 10 日
**Hive-Mind 版本**：1.48.2
**Agent CLI 版本**：最新版（含 PR #243 的免费模型更新）
