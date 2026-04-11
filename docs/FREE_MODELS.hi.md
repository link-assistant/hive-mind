# Hive-Mind में Free Models का समर्थन (languages: [en](FREE_MODELS.md) • [zh](FREE_MODELS.zh.md) • hi • [ru](FREE_MODELS.ru.md))

यह दस्तावेज़ `--tool agent` विकल्प का उपयोग करते समय hive-mind द्वारा समर्थित free models के बारे में व्यापक जानकारी प्रदान करता है।

> **अंतिम अपडेट:** 10 अप्रैल, 2026
> **संबंधित:**
>
> - [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) - Upstream free models सूची (canonical source)
> - [Agent PR #243](https://github.com/link-assistant/agent/pull/243) - Upstream: deprecated qwen3.6-plus-free को nemotron-3-super-free से default के रूप में replace करें
> - [Agent PR #234](https://github.com/link-assistant/agent/pull/234) - Upstream: qwen3.6-plus-free default के रूप में, nemotron-3-super-free जोड़ें
> - [Agent PR #209](https://github.com/link-assistant/agent/pull/209) - Upstream free model updates (minimax-m2.5-free default के रूप में)
> - [Agent Issue #208](https://github.com/link-assistant/agent/issues/208) - kimi-k2.5-free OpenCode Zen से हटाया गया

## उपलब्ध Free Models

Hive-mind दो providers के free models का समर्थन करता है:

1. **OpenCode Zen** - `opencode/` prefix के साथ 4 free models
2. **Kilo Gateway** - `kilo/` prefix के साथ 6 free models (Issue #1282)

---

## OpenCode Zen Free Models

### 1. opencode/nemotron-3-super-free **डिफ़ॉल्ट Model**

- **Short Alias**: `nemotron-3-super-free`
- **Provider**: OpenCode Zen
- **Status**: पूरी तरह समर्थित (Issue #1563 के अनुसार `--tool agent` के लिए Default)
- **Features**: Reasoning, tool calling, hybrid Mamba-Transformer architecture
- **Context Window**: ~262,144 tokens
- **Output Limit**: 262,144 tokens
- **Cost**: Free (कोई input/output charges नहीं)
- **Knowledge Cutoff**: जनवरी 2025
- **Release Date**: मार्च 2026
- **Open Weights**: हाँ
- **नोट्स**: NVIDIA hybrid Mamba-Transformer MoE, strong reasoning capabilities

### 2. opencode/minimax-m2.5-free

- **Short Alias**: `minimax-m2.5-free`
- **Provider**: OpenCode Zen
- **Status**: पूरी तरह समर्थित (पूर्व default, Issues #1391, #1543)
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: 204,800 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (कोई input/output charges नहीं)
- **Knowledge Cutoff**: जनवरी 2025
- **Release Date**: फरवरी 2026
- **Open Weights**: हाँ

### 3. opencode/gpt-5-nano

- **Short Alias**: `gpt-5-nano`
- **Provider**: OpenCode Zen
- **Status**: पूरी तरह समर्थित
- **Features**: Reasoning, tool calling, structured output, temperature control
- **Context Window**: ~400,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (कोई input/output charges नहीं)
- **Knowledge Cutoff**: जनवरी 2025

### 4. opencode/big-pickle

- **Short Alias**: `big-pickle`
- **Provider**: OpenCode Zen
- **Status**: पूरी तरह समर्थित
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: ~200,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (कोई input/output charges नहीं)
- **Knowledge Cutoff**: जनवरी 2025

---

## बंद किए गए OpenCode Zen Free Models

निम्नलिखित models पहले free थे लेकिन अब उपलब्ध नहीं हैं:

| Model              | पूर्व Model ID               | Status                                                                                                                                         |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen 3.6 Plus Free | `opencode/qwen3.6-plus-free` | Free promotion समाप्त (अप्रैल 2026) — अब OpenCode Go subscription आवश्यक है। [agent#242](https://github.com/link-assistant/agent/issues/242) देखें |
| Kimi K2.5 Free     | `opencode/kimi-k2.5-free`    | OpenCode Zen से हटाया गया (मार्च 2026) — [agent#208](https://github.com/link-assistant/agent/issues/208) देखें                                  |
| Grok Code Fast 1   | `opencode/grok-code`         | जनवरी 2026 में बंद                                                                                                                             |
| MiniMax M2.1 Free  | `opencode/minimax-m2.1-free` | `opencode/minimax-m2.5-free` से replace किया गया                                                                                              |
| GLM 4.7 Free       | `opencode/glm-4.7-free`      | OpenCode Zen पर अब free नहीं                                                                                                                   |

> **नोट:** Free models की वर्तमान सूची के लिए [OpenCode Zen Documentation](https://opencode.ai/docs/zen/) और [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) देखें।

---

## Kilo Gateway Free Models

[Kilo Gateway](https://kilo.ai) OpenAI-compatible API के माध्यम से 500+ AI models तक पहुँच प्रदान करता है। निम्नलिखित free models API key configuration के बिना उपलब्ध हैं।

> **नोट:** Kilo-exclusive models (केवल Kilo Gateway पर उपलब्ध models) `kilo/` prefix के बिना short aliases का समर्थन करते हैं। उदाहरण के लिए, आप `kilo/glm-5-free` के बजाय `glm-5-free` उपयोग कर सकते हैं क्योंकि यह model Kilo के लिए unique है।

### 1. kilo/glm-5-free **Kilo के लिए अनुशंसित**

- **Model ID**: `kilo/glm-5-free`
- **Short Alias**: `glm-5-free` (Kilo-exclusive model)
- **Provider**: Kilo Gateway (Z.AI)
- **Status**: पूरी तरह समर्थित (सीमित समय के लिए Free)
- **Features**: Deep reasoning, fast inference, bilingual (Chinese/English), tool calling, structured outputs
- **Context Window**: 202,752 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (सीमित समय का ऑफर)
- **Release Date**: 11 फरवरी, 2026
- **विशेष Features**: "कई tasks पर Opus 4.5 से मेल खाता है" - [Kilo Blog](https://blog.kilo.ai/p/glm-5-free-limited-time)

### 2. kilo/glm-4.5-air-free

- **Model ID**: `kilo/glm-4.5-air-free`
- **Short Alias**: `glm-4.5-air-free` (Kilo-exclusive model)
- **Provider**: Kilo Gateway (Z.AI)
- **Status**: पूरी तरह समर्थित
- **Features**: Agent-centric, lightweight, fast inference
- **Context Window**: 131,072 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free

### 3. kilo/minimax-m2.5-free

- **Model ID**: `kilo/minimax-m2.5-free`
- **Provider**: Kilo Gateway (MiniMax)
- **Status**: पूरी तरह समर्थित (M2.1 से upgrade)
- **Features**: Strong general-purpose performance
- **Context Window**: 204,800 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free

### 4. kilo/deepseek-r1-free

- **Model ID**: `kilo/deepseek-r1-free`
- **Short Alias**: `deepseek-r1-free` (Kilo-exclusive model)
- **Provider**: Kilo Gateway (DeepSeek)
- **Status**: पूरी तरह समर्थित
- **Features**: Advanced reasoning, open-source, fully open reasoning tokens
- **Context Window**: 163,840 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free

### 5. kilo/giga-potato-free

- **Model ID**: `kilo/giga-potato-free`
- **Short Alias**: `giga-potato-free` (Kilo-exclusive model)
- **Provider**: Kilo Gateway
- **Status**: पूरी तरह समर्थित (Evaluation period)
- **Features**: General-purpose evaluation model
- **Context Window**: 256,000 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (evaluation के दौरान)

### 6. kilo/trinity-large-preview

- **Model ID**: `kilo/trinity-large-preview`
- **Short Alias**: `trinity-large-preview` (Kilo-exclusive model)
- **Provider**: Kilo Gateway (Arcee AI)
- **Status**: पूरी तरह समर्थित (Preview)
- **Features**: Strong capabilities, preview model
- **Context Window**: 131,000 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free (preview)

---

---

## बंद किए गए Kilo Gateway Free Models

निम्नलिखित Kilo models पहले अनुशंसित free models थे लेकिन अब updated हैं:

| Model        | पूर्व Model ID           | Status                               |
| ------------ | ------------------------ | ------------------------------------ |
| GLM 4.7      | `kilo/glm-4.7-free`      | `kilo/glm-4.5-air-free` से replace किया गया |
| Kimi K2.5    | `kilo/kimi-k2.5-free`    | अन्य Kilo free models से replace किया गया |
| MiniMax M2.1 | `kilo/minimax-m2.1-free` | `kilo/minimax-m2.5-free` से replace किया गया |

> **नोट:** वर्तमान उपलब्धता के लिए [Kilo Free Models Documentation](https://kilo.ai/docs/advanced-usage/free-and-budget-models) देखें।

---

## उपयोग के उदाहरण

### Command Line उपयोग

```bash
# OpenCode Zen models (prefix के बिना short aliases)
solve https://github.com/owner/repo/issues/123 --tool agent --model nemotron-3-super-free
hive https://github.com/owner/repo --tool agent --model minimax-m2.5-free

# OpenCode Zen models (full model IDs)
solve https://github.com/owner/repo/issues/123 --tool agent --model opencode/nemotron-3-super-free
hive https://github.com/owner/repo --tool agent --model opencode/big-pickle

# Kilo Gateway models (full model IDs)
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
hive https://github.com/owner/repo --tool agent --model kilo/deepseek-r1-free

# Kilo-exclusive models (kilo/ prefix के बिना short aliases)
solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
hive https://github.com/owner/repo --tool agent --model deepseek-r1-free
```

### Telegram Bot उपयोग

```bash
# OpenCode Zen models (short aliases)
/solve https://github.com/owner/repo/issues/123 --tool agent --model nemotron-3-super-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model minimax-m2.5-free

# Kilo Gateway models (full model IDs)
/solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
/hive https://github.com/owner/repo --tool agent --model kilo/glm-4.5-air-free

# Kilo-exclusive models (kilo/ prefix के बिना short aliases)
/solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
/hive https://github.com/owner/repo --tool agent --model glm-4.5-air-free

# Default model (OpenCode Zen के माध्यम से nemotron-3-super-free):
/solve https://github.com/owner/repo/issues/123 --tool agent
```

### Direct Agent CLI उपयोग

```bash
# OpenCode Zen models
echo "Your prompt here" | agent --model opencode/nemotron-3-super-free
echo "Your prompt here" | agent --model opencode/minimax-m2.5-free

# Kilo Gateway models
echo "Your prompt here" | agent --model kilo/glm-5-free
echo "Your prompt here" | agent --model kilo/deepseek-r1-free
```

---

## Model चयन गाइड

### विभिन्न Use Cases के लिए

**Flagship Free Models**:

- `opencode/nemotron-3-super-free` - NVIDIA hybrid Mamba-Transformer, strong reasoning (OpenCode, default)
- `kilo/glm-5-free` - Z.AI flagship, कई tasks पर Opus 4.5 से मेल खाता है (Kilo)

**General Purpose और Reasoning**:

- `opencode/gpt-5-nano` - Strong general reasoning capabilities
- `opencode/big-pickle` - Well-balanced performance
- `kilo/minimax-m2.5-free` - Strong general-purpose performance
- `kilo/deepseek-r1-free` - Advanced reasoning model

**Large Context Tasks के लिए**:

- `opencode/gpt-5-nano` - बहुत बड़ा context (~400,000 tokens)
- `opencode/nemotron-3-super-free` - बड़ा context (~262,144 tokens)
- `kilo/giga-potato-free` - बड़ा context (256,000 tokens)
- `opencode/minimax-m2.5-free` - बड़ा context (204,800 tokens)

**Agent-Centric / Coding**:

- `kilo/glm-4.5-air-free` - agent-centric applications के लिए उद्देश्य-निर्मित
- `kilo/deepseek-r1-free` - reasoning और code synthesis के लिए optimized
- `opencode/minimax-m2.5-free` - Strong coding performance

---

## Provider तुलना

| Feature       | OpenCode Zen                          | Kilo Gateway             |
| ------------- | ------------------------------------- | ------------------------ |
| Free Models   | 4 models                              | 6 models                 |
| Default Model | nemotron-3-super-free (~262K context) | glm-5-free (recommended) |
| API Format    | OpenAI-compatible                     | OpenAI-compatible        |
| Free API Key  | `public`                              | `public`                 |
| Total Models  | 50+                                   | 500+                     |
| Flagship Free | Nemotron 3 Super (~262K context)      | GLM-5 (सीमित समय)        |
| BYOK Support  | हाँ                                   | हाँ                      |
| New Models    | Nemotron 3 Super (Issue #1543, #1563) | DeepSeek R1, GLM 4.5 Air |

---

## Testing और Validation

सभी free models के लिए test और validate किया गया है:

1. **Model Configuration**: सभी models `src/models/index.mjs` में properly configured हैं
2. **CLI Integration**: सभी models hive-mind और agent CLI दोनों द्वारा accept किए जाते हैं
3. **Tool Compatibility**: सभी models `--tool agent` विकल्प के साथ compatible हैं
4. **Case Insensitive Usage**: Models किसी भी case में specify किए जा सकते हैं (जैसे, `KILO/GLM-5-FREE`)
5. **Alias Support**: सभी models के लिए short aliases काम करते हैं

---

## त्रुटि हैंडलिंग

यदि आपको इनमें से किसी भी model के साथ समस्याएँ आती हैं:

1. **Model Spelling जांचें**: सुनिश्चित करें कि exact model name या alias उपयोग किया गया है
2. **Dependencies अपडेट करें**: नवीनतम agent CLI सुनिश्चित करने के लिए `npm install` चलाएं
3. **Network जांचें**: कुछ models को पहली बार setup के लिए internet access की आवश्यकता हो सकती है
4. **Provider Verify करें**: सुनिश्चित करें कि सही provider prefix उपयोग किया गया है (`opencode/` या `kilo/`)

---

## संबंधित दस्तावेज़

- [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) - Canonical upstream free models सूची
- [Models Module](../src/models/index.mjs) - Unified model data, validation, mapping और info
- [Agent CLI Documentation](https://github.com/link-assistant/agent) - Direct agent CLI उपयोग
- [Agent Kilo Documentation](https://github.com/link-assistant/agent/blob/main/docs/kilo.md) - Kilo Gateway विवरण
- [Case Study: Issue #1282](./case-studies/issue-1282/README.md) - Kilo models integration analysis
- [Case Study: Issue #1300](./case-studies/issue-1300/README.md) - Free models update (MiniMax M2.5, DeepSeek R1)
- [Case Study: Issue #1391](./case-studies/issue-1391/README.md) - Free models update (minimax-m2.5-free default के रूप में, kimi-k2.5-free deprecated)
- [Case Study: Issue #1473](./case-studies/issue-1473/README.md) - Model recognition fix और free models sync
- [Case Study: Issue #1543](./case-studies/issue-1543/README.md) - Free models update (qwen3.6-plus-free default के रूप में, nemotron-3-super-free जोड़ा गया)
- [Case Study: Issue #1563](./case-studies/issue-1563/README.md) - Free models update (qwen3.6-plus-free deprecated, nemotron-3-super-free default के रूप में)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/) - OpenCode Zen provider विवरण
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway) - Kilo Gateway provider विवरण

---

**अंतिम अपडेट**: 10 अप्रैल, 2026
**Hive-Mind Version**: 1.48.2
**Agent CLI Version**: Latest (PR #243 से free model updates के साथ)
