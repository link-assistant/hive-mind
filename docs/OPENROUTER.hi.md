# OpenRouter सेटअप गाइड (languages: [en](OPENROUTER.md) • [zh](OPENROUTER.zh.md) • hi • [ru](OPENROUTER.ru.md))

यह गाइड बताती है कि Claude Code CLI और @link-assistant/agent दोनों के लिए OpenRouter को कैसे configure करें, जिससे आप एक unified API के माध्यम से 60+ providers के 500+ AI models उपयोग कर सकते हैं।

## विषय-सूची

- [अवलोकन](#overview)
- [पूर्वापेक्षाएँ](#prerequisites)
- [OpenRouter के साथ Claude Code CLI](#claude-code-cli-with-openrouter)
- [OpenRouter के साथ Agent CLI](#agent-cli-with-openrouter)
- [Model चयन](#model-selection)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## अवलोकन

OpenRouter एक unified API gateway प्रदान करता है जो आपको individual subscriptions की आवश्यकता के बिना विभिन्न AI models तक पहुँचने देता है। लाभों में शामिल हैं:

- **500+ Models**: OpenAI, Anthropic, Google, Meta और 60+ providers के models तक पहुँच
- **Pay-as-you-go**: कोई monthly subscriptions आवश्यक नहीं
- **Unified API**: Single API key सभी providers पर काम करती है
- **Fallback Support**: Providers के बीच Automatic failover

## पूर्वापेक्षाएँ

1. **OpenRouter Account**: [openrouter.ai](https://openrouter.ai/) पर sign up करें
2. **API Key**: अपनी API key [OpenRouter Keys](https://openrouter.ai/keys) से प्राप्त करें
3. **Claude Code CLI** और/या **@link-assistant/agent** इंस्टॉल किया हुआ

## OpenRouter के साथ Claude Code CLI

Claude Code CLI Anthropic के native protocol का उपयोग करके OpenRouter से connect हो सकता है।

### Step 1: Environment Variables सेट करें

इन्हें अपने shell profile (`~/.bashrc`, `~/.zshrc`, या `~/.config/fish/config.fish`) में जोड़ें:

```bash
# आवश्यक: Claude Code को OpenRouter पर point करें
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"

# आवश्यक: आपकी OpenRouter API key
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-your-api-key-here"

# आवश्यक: conflicts रोकने के लिए explicitly blank होना चाहिए
export ANTHROPIC_API_KEY=""
```

### Step 2: Model Configuration (वैकल्पिक)

OpenRouter-compatible alternatives के साथ default models override करें:

```bash
# OpenRouter से specific models उपयोग करें
export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4"
export ANTHROPIC_DEFAULT_OPUS_MODEL="anthropic/claude-opus-4"
export ANTHROPIC_SMALL_FAST_MODEL="anthropic/claude-haiku"
```

### Step 3: Configuration Apply करें

```bash
# Shell profile reload करें
source ~/.bashrc  # या ~/.zshrc
```

### वैकल्पिक: Project-Level Configuration

अपने project root में `.claude/settings.local.json` बनाएं:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-your-api-key-here",
    "ANTHROPIC_API_KEY": ""
  }
}
```

**नोट**: अपनी API key सुरक्षित करने के लिए `.claude/settings.local.json` को `.gitignore` में जोड़ें।

### Step 4: Claude Code लॉन्च करें

```bash
cd /path/to/your/project
claude
```

## OpenRouter के साथ Agent CLI

@link-assistant/agent `agent auth login` command या environment variables के माध्यम से OpenRouter का समर्थन करता है।

### Method 1: Interactive Authentication

```bash
# Interactive login शुरू करें
agent auth login

# Provider list से "openrouter" चुनें
# Prompted होने पर अपनी OpenRouter API key दर्ज करें
```

### Method 2: Environment Variable

```bash
export OPENROUTER_API_KEY="sk-or-v1-your-api-key-here"
```

### Method 3: Direct Model Usage

```bash
# openrouter/ prefix के साथ कोई भी OpenRouter model उपयोग करें
echo "hello" | agent --model openrouter/anthropic/claude-sonnet-4

# या OpenCode Zen models उपयोग करें (default)
echo "hello" | agent --model opencode/grok-code
```

### Authentication Status जांचें

```bash
# कॉन्फ़िगर किए गए credentials की सूची बनाएं
agent auth list

# दिखाना चाहिए:
# ◆ openrouter api-key
```

## Model चयन

### OpenRouter के माध्यम से Claude Code CLI Models

| Use Case         | Environment Variable             | उदाहरण Value               |
| ---------------- | -------------------------------- | --------------------------- |
| Main model       | `ANTHROPIC_DEFAULT_SONNET_MODEL` | `anthropic/claude-sonnet-4` |
| Powerful model   | `ANTHROPIC_DEFAULT_OPUS_MODEL`   | `anthropic/claude-opus-4`   |
| Fast/cheap model | `ANTHROPIC_SMALL_FAST_MODEL`     | `anthropic/claude-haiku`    |

### OpenRouter के माध्यम से Agent CLI Models

Provider और model के बाद `openrouter/` prefix उपयोग करें:

```bash
# Anthropic models
agent --model openrouter/anthropic/claude-sonnet-4

# OpenAI models
agent --model openrouter/openai/gpt-4o

# Google models
agent --model openrouter/google/gemini-2.0-flash

# Meta models
agent --model openrouter/meta-llama/llama-3.1-405b-instruct
```

### महत्वपूर्ण: Tool Use Support

वैकल्पिक models चुनते समय, सुनिश्चित करें कि वे **tool use** capabilities का समर्थन करते हैं। Claude Code और agent tools पर निर्भर करते हैं:

- फ़ाइलें पढ़ना और लिखना
- Terminal commands execute करना
- Codebases search करना
- Web searches करना

Tool use support के बिना models ठीक से काम नहीं करेंगे।

## Verification

### Claude Code CLI

Connection verify करने के लिए Claude Code के भीतर `/status` चलाएं:

```
Claude Code v1.x.x
Connected to: openrouter.ai
Model: anthropic/claude-sonnet-4
```

Real-time request logs के लिए [OpenRouter Activity Dashboard](https://openrouter.ai/activity) भी जांचें।

### Agent CLI

```bash
# सरल test
echo "What is 2+2?" | agent --model openrouter/anthropic/claude-sonnet-4

# कॉन्फ़िगर किए गए credentials जांचें
agent auth list
```

## Troubleshooting

### "Authentication failed" त्रुटि

1. [openrouter.ai/keys](https://openrouter.ai/keys) पर अपनी API key verify करें
2. सुनिश्चित करें कि Claude Code के लिए `ANTHROPIC_API_KEY=""` explicitly set (blank) है
3. `ANTHROPIC_AUTH_TOKEN` value में typos जांचें

### "Model not found" त्रुटि

1. [openrouter.ai/models](https://openrouter.ai/models) पर model ID verify करें
2. Full model path उपयोग करें: `provider/model-name`
3. जांचें कि model आपके region में उपलब्ध है

### "Insufficient credits" त्रुटि

1. [openrouter.ai/credits](https://openrouter.ai/credits) पर credits जोड़ें
2. [openrouter.ai/activity](https://openrouter.ai/activity) पर अपना usage जांचें

### Claude Code OpenRouter उपयोग नहीं कर रहा

Verify करें कि environment variables सेट हैं:

```bash
echo $ANTHROPIC_BASE_URL
# Output होना चाहिए: https://openrouter.ai/api

echo $ANTHROPIC_AUTH_TOKEN
# Output होना चाहिए: sk-or-v1-...

echo $ANTHROPIC_API_KEY
# खाली होना चाहिए
```

### Agent CLI Auth Issues

```bash
# मौजूदा credentials हटाएं
agent auth logout
# "openrouter" चुनें

# Re-authenticate करें
agent auth login
# "openrouter" चुनें और अपनी API key दर्ज करें
```

## Security सर्वोत्तम प्रथाएँ

1. **API keys कभी commit न करें**: Configuration files को `.gitignore` में जोड़ें
2. **Environment variables उपयोग करें**: Project files की तुलना में shell profile prefer करें
3. **Keys नियमित रूप से rotate करें**: [openrouter.ai/keys](https://openrouter.ai/keys) पर नई keys generate करें
4. **Usage monitor करें**: Suspicious requests के लिए [activity dashboard](https://openrouter.ai/activity) जांचें

## संदर्भ

- [OpenRouter Documentation](https://openrouter.ai/docs)
- [OpenRouter Models](https://openrouter.ai/models)
- [Claude Code CLI](https://claude.ai/code)
- [@link-assistant/agent](https://github.com/link-assistant/agent)
