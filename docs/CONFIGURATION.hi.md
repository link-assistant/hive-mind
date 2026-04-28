# कॉन्फ़िगरेशन गाइड (languages: [en](CONFIGURATION.md) • [zh](CONFIGURATION.zh.md) • hi • [ru](CONFIGURATION.ru.md))

Hive Mind एप्लिकेशन environment variables और command-line विकल्पों के माध्यम से व्यापक कॉन्फ़िगरेशन का समर्थन करता है। यह दस्तावेज़ सभी उपलब्ध कॉन्फ़िगरेशन विकल्पों के लिए एक संपूर्ण संदर्भ प्रदान करता है।

> **OpenRouter एकीकरण**: Claude Code CLI या @link-assistant/agent को OpenRouter (60+ प्रदाताओं से 500+ models) के साथ उपयोग करने के लिए, समर्पित [OpenRouter सेटअप गाइड](./OPENROUTER.hi.md) देखें।

## विषय-सूची

- [Environment Variables](#environment-variables)
  - [Timeout कॉन्फ़िगरेशन](#1-timeout-configurations)
  - [Auto-Continue सेटिंग्स](#2-auto-continue-settings)
  - [Limit Reset सेटिंग्स](#22-limit-reset-settings)
  - [GitHub API सीमाएँ](#3-github-api-limits)
  - [सिस्टम संसाधन सीमाएँ](#4-system-resource-limits)
  - [Retry कॉन्फ़िगरेशन](#5-retry-configurations)
  - [Cache TTL कॉन्फ़िगरेशन](#51-cache-ttl-configurations)
  - [Claude Code CLI कॉन्फ़िगरेशन](#52-claude-code-cli-configurations)
  - [फ़ाइल और पथ सेटिंग्स](#6-file-and-path-settings)
  - [टेक्स्ट प्रोसेसिंग](#7-text-processing)
  - [डिस्प्ले सेटिंग्स](#8-display-settings)
  - [Sentry त्रुटि ट्रैकिंग](#9-sentry-error-tracking)
  - [बाहरी URLs](#10-external-urls)
  - [Model कॉन्फ़िगरेशन](#11-model-configuration)
  - [Version सेटिंग्स](#12-version-settings)
  - [Merge Queue कॉन्फ़िगरेशन](#121-merge-queue-configurations)
  - [Telegram Bot](#13-telegram-bot)
  - [YouTrack एकीकरण](#14-youtrack-integration)
  - [Tool पथ](#15-tool-paths)
  - [Debug और Development](#16-debug-and-development)
  - [Playwright MCP](#17-playwright-mcp)
- [Command-Line विकल्प](#command-line-options)
  - [solve विकल्प](#solve-options)
  - [hive विकल्प](#hive-options)
  - [hive-telegram-bot विकल्प](#hive-telegram-bot-options)
- [उपयोग के उदाहरण](#usage-examples)

---

## Environment Variables

सभी environment variables को `src/config.lib.mjs` मॉड्यूल के माध्यम से प्रबंधित किया जाता है जो मजबूत हैंडलिंग के लिए `getenv` का उपयोग करता है। JavaScript परंपराओं के अनुरूप कॉन्फ़िगरेशन camelCase प्रॉपर्टी नामों का उपयोग करता है।

### 1. Timeout कॉन्फ़िगरेशन

| Environment Variable                 | डिफ़ॉल्ट | विवरण                                                                                   |
| ------------------------------------ | -------- | --------------------------------------------------------------------------------------- |
| `HIVE_MIND_CLAUDE_TIMEOUT_SECONDS`   | 60       | Claude CLI timeout सेकंड में                                                            |
| `HIVE_MIND_OPENCODE_TIMEOUT_SECONDS` | 60       | OpenCode CLI timeout सेकंड में                                                          |
| `HIVE_MIND_CODEX_TIMEOUT_SECONDS`    | 60       | Codex CLI timeout सेकंड में                                                             |
| `HIVE_MIND_GITHUB_API_DELAY_MS`      | 5000     | GitHub API कॉल्स के बीच देरी (ms)                                                       |
| `HIVE_MIND_GITHUB_REPO_DELAY_MS`     | 2000     | repository ऑपरेशन के बीच देरी (ms)                                                      |
| `HIVE_MIND_RETRY_BASE_DELAY_MS`      | 5000     | retry ऑपरेशन के लिए बेस देरी (ms)                                                       |
| `HIVE_MIND_RETRY_BACKOFF_DELAY_MS`   | 1000     | retries के लिए backoff देरी (ms)                                                        |
| `HIVE_MIND_RESULT_STREAM_CLOSE_MS`   | 30000    | result event के बाद stream बंद होने की प्रतीक्षा के लिए Timeout (ms) force-kill से पहले |

### 2. Auto-Continue सेटिंग्स

| Environment Variable                | डिफ़ॉल्ट | विवरण                                                |
| ----------------------------------- | -------- | ---------------------------------------------------- |
| `HIVE_MIND_AUTO_CONTINUE_AGE_HOURS` | 24       | auto-continue से पहले PRs की न्यूनतम आयु (घंटों में) |

### 2.2. Limit Reset सेटिंग्स

| Environment Variable              | डिफ़ॉल्ट | विवरण                                                     |
| --------------------------------- | -------- | --------------------------------------------------------- |
| `HIVE_MIND_LIMIT_RESET_BUFFER_MS` | 300000   | limit reset के बाद प्रतीक्षा के लिए बफर समय (5 मिनट) (ms) |

### 3. GitHub API सीमाएँ

| Environment Variable                   | डिफ़ॉल्ट | विवरण                                          |
| -------------------------------------- | -------- | ---------------------------------------------- |
| `HIVE_MIND_GITHUB_COMMENT_MAX_SIZE`    | 65536    | GitHub comments का अधिकतम आकार (bytes)         |
| `HIVE_MIND_GITHUB_FILE_MAX_SIZE`       | 26214400 | GitHub ऑपरेशन के लिए अधिकतम फ़ाइल आकार (25MB)  |
| `HIVE_MIND_GITHUB_ISSUE_BODY_MAX_SIZE` | 60000    | issue body का अधिकतम आकार (bytes)              |
| `HIVE_MIND_GITHUB_ATTACHMENT_MAX_SIZE` | 10485760 | अधिकतम attachment आकार (10MB)                  |
| `HIVE_MIND_GITHUB_BUFFER_MAX_SIZE`     | 10485760 | GitHub ऑपरेशन के लिए अधिकतम buffer आकार (10MB) |

### 4. सिस्टम संसाधन सीमाएँ

| Environment Variable             | डिफ़ॉल्ट | विवरण                            |
| -------------------------------- | -------- | -------------------------------- |
| `HIVE_MIND_MIN_DISK_SPACE_MB`    | 2048     | MB में न्यूनतम आवश्यक disk स्थान |
| `HIVE_MIND_DEFAULT_PAGE_SIZE_KB` | 16       | KB में डिफ़ॉल्ट memory page आकार |

### 5. Retry कॉन्फ़िगरेशन

| Environment Variable                   | डिफ़ॉल्ट | विवरण                             |
| -------------------------------------- | -------- | --------------------------------- |
| `HIVE_MIND_MAX_FORK_RETRIES`           | 5        | अधिकतम fork निर्माण retries       |
| `HIVE_MIND_MAX_VERIFY_RETRIES`         | 5        | अधिकतम verification retries       |
| `HIVE_MIND_MAX_API_RETRIES`            | 3        | अधिकतम API कॉल retries            |
| `HIVE_MIND_RETRY_BACKOFF_MULTIPLIER`   | 2        | Retry backoff गुणक                |
| `HIVE_MIND_MAX_503_RETRIES`            | 3        | अधिकतम 503 त्रुटि retries         |
| `HIVE_MIND_INITIAL_503_RETRY_DELAY_MS` | 300000   | प्रारंभिक 503 retry देरी (5 मिनट) |

### 5.1. Cache TTL कॉन्फ़िगरेशन

ये सेटिंग्स नियंत्रित करती हैं कि नया अनुरोध करने से पहले API responses कितनी देर तक cache में रहती हैं।

| Environment Variable               | डिफ़ॉल्ट | विवरण                                                                                                                                                       |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_API_CACHE_TTL_MS`       | 180000   | सामान्य API cache TTL ms में (3 मिनट)। GitHub API के लिए उपयोग किया जाता है।                                                                                |
| `HIVE_MIND_USAGE_API_CACHE_TTL_MS` | 600000   | Claude Usage API cache TTL ms में (10 मिनट)। **महत्वपूर्ण:** Claude Usage API में सख्त rate limiting है। इसे अधिक बार कॉल करने पर null values मिल सकती हैं। |
| `HIVE_MIND_SYSTEM_CACHE_TTL_MS`    | 120000   | सिस्टम metrics cache TTL ms में (2 मिनट)। RAM, CPU और disk space के लिए उपयोग किया जाता है।                                                                 |

**नोट:** Claude Usage API (`/api/oauth/usage`) अन्य APIs की तुलना में अधिक सख्ती से rate-limited है। यदि आप `/limits` command output में `null` values अनुभव करते हैं, तो API कॉल की आवृत्ति बहुत अधिक हो सकती है। डिफ़ॉल्ट 10-मिनट TTL इस समस्या से बचने के लिए डिज़ाइन किया गया है। विवरण के लिए [Issue #1074](https://github.com/link-assistant/hive-mind/issues/1074) देखें।

### 5.2. Claude Code CLI कॉन्फ़िगरेशन

ये सेटिंग्स Claude Code CLI व्यवहार को नियंत्रित करती हैं, जिसमें output सीमाएँ और MCP timeouts शामिल हैं।

| Environment Variable                    | डिफ़ॉल्ट | विवरण                                                                                                    |
| --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`         | 64000    | Claude Code CLI responses के लिए अधिकतम output tokens (यह भी: `HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS`) |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS_OPUS_46` | 128000   | Opus 4.6+ के लिए अधिकतम output tokens (यह भी: `HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS_OPUS_46`)         |
| `MCP_TIMEOUT`                           | 900000   | MCP server startup timeout ms में (15 मिनट) (यह भी: `HIVE_MIND_MCP_TIMEOUT`)                             |
| `MCP_TOOL_TIMEOUT`                      | 900000   | MCP tool execution timeout ms में (15 मिनट) (यह भी: `HIVE_MIND_MCP_TOOL_TIMEOUT`)                        |
| `HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46` | 31999    | Opus 4.6+ models के लिए डिफ़ॉल्ट max thinking budget                                                     |

**नोट:** Claude models अलग-अलग max output tokens का समर्थन करते हैं: Opus 4.6 (डिफ़ॉल्ट `opus` alias) 128K tokens का समर्थन करता है, जबकि Sonnet 4.5, Opus 4.5 और Haiku 4.5 64K tokens का समर्थन करते हैं। MCP timeouts (डिफ़ॉल्ट रूप से 15 मिनट) लंबे समय तक चलने वाले Playwright ऑपरेशन को समायोजित करते हैं। विवरण के लिए [Issue #1076](https://github.com/link-assistant/hive-mind/issues/1076) और [Issue #1066](https://github.com/link-assistant/hive-mind/issues/1066) देखें।

### 6. फ़ाइल और पथ सेटिंग्स

| Environment Variable           | डिफ़ॉल्ट      | विवरण                   |
| ------------------------------ | ------------- | ----------------------- |
| `HIVE_MIND_TEMP_DIR`           | /tmp          | अस्थायी directory पथ    |
| `HIVE_MIND_TASK_INFO_FILENAME` | CLAUDE.md     | Task info filename      |
| `HIVE_MIND_PROC_MEMINFO`       | /proc/meminfo | memory info फ़ाइल का पथ |

### 7. टेक्स्ट प्रोसेसिंग

| Environment Variable               | डिफ़ॉल्ट | विवरण                                             |
| ---------------------------------- | -------- | ------------------------------------------------- |
| `HIVE_MIND_TOKEN_MASK_MIN_LENGTH`  | 12       | token masking के लिए न्यूनतम लंबाई                |
| `HIVE_MIND_TOKEN_MASK_START_CHARS` | 5        | masking करते समय शुरुआत में दिखाए जाने वाले अक्षर |
| `HIVE_MIND_TOKEN_MASK_END_CHARS`   | 5        | masking करते समय अंत में दिखाए जाने वाले अक्षर    |
| `HIVE_MIND_TEXT_PREVIEW_LENGTH`    | 100      | टेक्स्ट previews की लंबाई                         |
| `HIVE_MIND_LOG_TRUNCATION_LENGTH`  | 5000     | Log truncation लंबाई                              |

### 8. डिस्प्ले सेटिंग्स

| Environment Variable    | डिफ़ॉल्ट | विवरण                                 |
| ----------------------- | -------- | ------------------------------------- |
| `HIVE_MIND_LABEL_WIDTH` | 25       | formatted output में labels की चौड़ाई |

### 9. Sentry त्रुटि ट्रैकिंग

| Environment Variable                                | डिफ़ॉल्ट  | विवरण                                                                 |
| --------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| `HIVE_MIND_SENTRY_DSN`                              | (प्रदत्त) | त्रुटि ट्रैकिंग के लिए Sentry DSN                                     |
| `HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_DEV`           | 1.0       | development में trace sample rate                                     |
| `HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_PROD`          | 0.1       | production में trace sample rate                                      |
| `HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_DEV`  | 1.0       | development में profile sample rate                                   |
| `HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_PROD` | 0.1       | production में profile sample rate                                    |
| `HIVE_MIND_NO_SENTRY`                               | true      | Sentry अक्षम करें ("true" पर सेट करें; Sentry डिफ़ॉल्ट रूप से बंद है) |
| `DISABLE_SENTRY`                                    | true      | Sentry अक्षम करने का वैकल्पिक तरीका (Sentry डिफ़ॉल्ट रूप से बंद है)   |
| `HIVE_MIND_SENTRY`                                  | false     | Sentry सक्षम करें (opt in के लिए "true" पर सेट करें)                  |

### 10. बाहरी URLs

| Environment Variable        | डिफ़ॉल्ट           | विवरण                                     |
| --------------------------- | ------------------ | ----------------------------------------- |
| `HIVE_MIND_GITHUB_BASE_URL` | https://github.com | GitHub बेस URL (GitHub Enterprise के लिए) |
| `HIVE_MIND_BUN_INSTALL_URL` | https://bun.sh/    | Bun इंस्टॉलेशन URL                        |

### 11. Model कॉन्फ़िगरेशन

| Environment Variable         | डिफ़ॉल्ट            | विवरण                              |
| ---------------------------- | ------------------- | ---------------------------------- |
| `HIVE_MIND_AVAILABLE_MODELS` | opus, sonnet, haiku | उपलब्ध models (Links Notation)     |
| `HIVE_MIND_DEFAULT_MODEL`    | sonnet              | उपयोग करने के लिए डिफ़ॉल्ट model   |
| `HIVE_MIND_RESTRICT_MODELS`  | false               | केवल सूचीबद्ध models तक सीमित करें |

### 12. Version सेटिंग्स

| Environment Variable         | डिफ़ॉल्ट | विवरण                   |
| ---------------------------- | -------- | ----------------------- |
| `HIVE_MIND_VERSION_FALLBACK` | 0.14.3   | Fallback version संख्या |
| `HIVE_MIND_VERSION_DEFAULT`  | 0.14.3   | डिफ़ॉल्ट version संख्या |

### 12.1. Merge Queue कॉन्फ़िगरेशन

ये सेटिंग्स automated PR merging के लिए merge queue व्यवहार को नियंत्रित करती हैं।

| Environment Variable                        | डिफ़ॉल्ट | विवरण                                                               |
| ------------------------------------------- | -------- | ------------------------------------------------------------------- |
| `HIVE_MIND_MERGE_QUEUE_MAX_PRS`             | 10       | एक merge session में अधिकतम PRs प्रोसेस किए जाएँ                    |
| `HIVE_MIND_MERGE_QUEUE_CI_POLL_INTERVAL_MS` | 300000   | CI/CD polling interval ms में (5 मिनट)                              |
| `HIVE_MIND_MERGE_QUEUE_CI_TIMEOUT_MS`       | 25200000 | CI/CD timeout ms में (7 घंटे)                                       |
| `HIVE_MIND_MERGE_QUEUE_POST_MERGE_WAIT_MS`  | 60000    | अगले PR को प्रोसेस करने से पहले merge के बाद प्रतीक्षा समय (1 मिनट) |
| `HIVE_MIND_MERGE_QUEUE_MERGE_METHOD`        | merge    | डिफ़ॉल्ट merge method: `merge`, `squash`, या `rebase`               |

**नोट:** विवरण के लिए [Issue #1143](https://github.com/link-assistant/hive-mind/issues/1143) और [Issue #1269](https://github.com/link-assistant/hive-mind/issues/1269) देखें।

### 13. Telegram Bot

| Environment Variable                       | डिफ़ॉल्ट   | विवरण                                                                         |
| ------------------------------------------ | ---------- | ----------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                       | (आवश्यक)   | @BotFather से Telegram bot token                                              |
| `TELEGRAM_ALLOWED_CHATS`                   | (सभी)      | अनुमत chat IDs (Links Notation)                                               |
| `TELEGRAM_SOLVE_OVERRIDES`                 | (कोई नहीं) | /solve के लिए override विकल्प (Links Notation)                                |
| `TELEGRAM_HIVE_OVERRIDES`                  | (कोई नहीं) | /hive के लिए override विकल्प (Links Notation)                                 |
| `TELEGRAM_SOLVE`                           | true       | /solve command सक्षम करें                                                     |
| `TELEGRAM_HIVE`                            | true       | /hive command सक्षम करें                                                      |
| `TELEGRAM_AUTO_START_SCREEN_WATCH_MESSAGE` | false      | public /solve sessions के लिए अलग live terminal watch message auto-start करें |
| `TELEGRAM_BOT_VERBOSE`                     | false      | verbose logging सक्षम करें                                                    |
| `TELEGRAM_CONFIGURATION`                   | (कोई नहीं) | LINO configuration string                                                     |

### 14. YouTrack एकीकरण

| Environment Variable    | डिफ़ॉल्ट   | विवरण                                                              |
| ----------------------- | ---------- | ------------------------------------------------------------------ |
| `YOUTRACK_URL`          | (आवश्यक)   | YouTrack instance URL                                              |
| `YOUTRACK_API_KEY`      | (आवश्यक)   | YouTrack API authentication key                                    |
| `YOUTRACK_PROJECT_CODE` | (आवश्यक)   | YouTrack project code                                              |
| `YOUTRACK_STAGE`        | (आवश्यक)   | मॉनिटर करने के लिए YouTrack stage                                  |
| `YOUTRACK_NEXT_STAGE`   | (वैकल्पिक) | प्रोसेसिंग के बाद issues को स्थानांतरित करने के लिए YouTrack stage |

### 15. Tool पथ

| Environment Variable | डिफ़ॉल्ट | विवरण                         |
| -------------------- | -------- | ----------------------------- |
| `CLAUDE_PATH`        | claude   | Claude CLI executable का पथ   |
| `OPENCODE_PATH`      | opencode | OpenCode CLI executable का पथ |
| `CODEX_PATH`         | codex    | Codex CLI executable का पथ    |
| `AGENT_PATH`         | agent    | Agent CLI executable का पथ    |

### 16. Debug और Development

| Environment Variable | डिफ़ॉल्ट   | विवरण                     |
| -------------------- | ---------- | ------------------------- |
| `DEBUG`              | false      | debug mode सक्षम करें     |
| `NODE_ENV`           | production | Node.js environment       |
| `CI`                 | false      | CI environment flag       |
| `VERBOSE`            | false      | verbose output सक्षम करें |

### 17. Playwright MCP

Playwright MCP (Model Context Protocol) Claude Code के लिए browser automation क्षमताएँ प्रदान करता है, जो web scraping, UI testing और dynamic web pages के साथ इंटरैक्शन सक्षम करता है।

#### इंस्टॉलेशन

```bash
# अनुशंसित: memory-safe सेटिंग्स के साथ इंस्टॉल करें (servers और Docker के लिए)
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080

# न्यूनतम इंस्टॉलेशन (local development के लिए)
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless
```

#### Command-Line Arguments

| Argument                 | विवरण                                            | Memory प्रभाव                                          |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| `--isolated`             | Ephemeral browser contexts (सबसे महत्वपूर्ण)     | **उच्च** - Process accumulation रोकता है               |
| `--headless`             | Browser को headless mode में चलाएं               | **मध्यम** - UI memory overhead कम करता है              |
| `--browser <type>`       | Browser: chromium, firefox, webkit, msedge       | **परिवर्तनशील** - WebKit अक्सर कम memory उपयोग करता है |
| `--no-sandbox`           | Sandbox अक्षम करें (केवल नियंत्रित environments) | **कम** - Memory थोड़ा कम करता है                       |
| `--timeout-action <ms>`  | Actions के लिए Timeout (डिफ़ॉल्ट: 5000)          | **N/A** - Hung processes रोकता है                      |
| `--viewport-size <size>` | Viewport आयाम सेट करें (जैसे, "1280x720")        | **कम** - Rendering memory को प्रभावित करता है          |
| `--storage-state <path>` | Full profile के बिना auth state लोड करें         | **मध्यम** - Profile bloat के बिना Auth                 |

#### Scope विकल्प

| Scope     | विवरण                                    | Config स्थान                        |
| --------- | ---------------------------------------- | ----------------------------------- |
| `local`   | केवल वर्तमान directory                   | `~/.claude.json` (project-specific) |
| `project` | Version control के माध्यम से team-shared | `.mcp.json` (project root)          |
| `user`    | Globally उपलब्ध                          | `~/.claude.json` (user section)     |

#### JSON कॉन्फ़िगरेशन

`~/.claude.json` में सीधे कॉन्फ़िगरेशन:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--isolated", "--headless", "--no-sandbox", "--timeout-action=600000", "--viewport-size", "1920x1080"],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "/opt/playwright/browsers"
      }
    }
  }
}
```

#### MCP Commands

```bash
# कॉन्फ़िगर किए गए MCP servers की सूची बनाएं
claude mcp list

# Server विवरण प्राप्त करें
claude mcp get playwright

# Server हटाएं
claude mcp remove playwright
```

#### सर्वोत्तम प्रथाएँ

1. **हमेशा `--isolated` mode का उपयोग करें** - Chrome process accumulation और memory leaks रोकता है
2. **एक विशिष्ट version पर pin करें** - स्थिरता के लिए `@latest` के बजाय `@playwright/mcp@0.0.49` उपयोग करें
3. **servers के लिए `--headless` उपयोग करें** - CI/CD और production environments में memory overhead कम करता है
4. **Claude Code को समय-समय पर restart करें** - लंबे सत्रों के लिए accumulated browser resources साफ़ करने के लिए

व्यापक कॉन्फ़िगरेशन विकल्पों, troubleshooting और advanced use cases के लिए, विस्तृत गाइड देखें:
[Playwright MCP Configuration Guide](./case-studies/issue-837-playwright-mcp-chrome-leak/04-CLAUDE-PLAYWRIGHT-MCP-CONFIGURATION.md)

---

## Command-Line विकल्प

### solve विकल्प

```bash
solve <issue-url> [options]
```

| विकल्प                                                           | Alias | प्रकार  | डिफ़ॉल्ट      | विवरण                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ----- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--model`                                                        | `-m`  | string  | sonnet        | Model (claude के लिए opus, sonnet, haiku; opencode के लिए grok-code-fast-1; codex के लिए gpt-5)                                                                                                                                                                                                                                                                                       |
| `--worker-model`                                                 |       | string  |               | --model का Alias: --plan-model निर्दिष्ट होने पर execution/worker model                                                                                                                                                                                                                                                                                                               |
| `--tool`                                                         |       | string  | claude        | AI tool (claude, opencode, codex, agent)                                                                                                                                                                                                                                                                                                                                              |
| `--plan`                                                         |       | boolean | false         | plan mode सक्षम करें: planning के लिए opus, execution के लिए sonnet (केवल --tool claude)                                                                                                                                                                                                                                                                                              |
| `--plan-model`                                                   |       | string  |               | plan mode के लिए model (जैसे, opus)। Auto-switches to opusplan mode (केवल --tool claude)                                                                                                                                                                                                                                                                                              |
| `--think`                                                        |       | string  |               | Thinking level (off, low, medium, high, max)                                                                                                                                                                                                                                                                                                                                          |
| `--thinking-budget`                                              |       | number  |               | Thinking token budget (0-31999)। MAX_THINKING_TOKENS नियंत्रित करता है                                                                                                                                                                                                                                                                                                                |
| `--thinking-budget-claude-minimum-version`                       |       | string  | 2.1.12        | --thinking-budget का समर्थन करने वाला न्यूनतम Claude Code version                                                                                                                                                                                                                                                                                                                     |
| `--max-thinking-budget`                                          |       | number  | 31999         | level mappings के लिए अधिकतम thinking budget                                                                                                                                                                                                                                                                                                                                          |
| `--sub-session-size`                                             |       | string  | 150k          | auto-compaction events के बीच sub-session size की सीमा। token count (जैसे `150k`, `1m`, `200000`), model context window का percentage (जैसे `50%`), या `default` (tool की default threshold) स्वीकार करता है। Claude के लिए `CLAUDE_CODE_AUTO_COMPACT_WINDOW` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` env vars set करता है; Codex के लिए `-c model_auto_compact_token_limit` use करता है। |
| `--disable-1m-context`                                           |       | boolean | true          | 1M extended context window disable करता है ताकि model अपनी standard 200K-400K window का उपयोग करे। reasoning quality preserve करने और cost कम करने में मदद करता है। Claude के लिए `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` set करता है; Codex के लिए `-c model_context_window=200000` use करता है। 1M window allow करने के लिए `--no-disable-1m-context` use करें।                          |
| `--fork`                                                         | `-f`  | boolean | false         | write access न होने पर repo fork करें                                                                                                                                                                                                                                                                                                                                                 |
| `--auto-fork`                                                    |       | boolean | true          | write access के बिना public repos को automatically fork करें                                                                                                                                                                                                                                                                                                                          |
| `--base-branch`                                                  | `-b`  | string  | (default)     | PR के लिए target branch                                                                                                                                                                                                                                                                                                                                                               |
| `--resume`                                                       | `-r`  | string  |               | session ID से resume करें                                                                                                                                                                                                                                                                                                                                                             |
| `--working-directory`                                            | `-d`  | string  |               | निर्दिष्ट working directory उपयोग करें (--resume के लिए आवश्यक)                                                                                                                                                                                                                                                                                                                       |
| `--verbose`                                                      | `-v`  | boolean | false         | verbose logging सक्षम करें                                                                                                                                                                                                                                                                                                                                                            |
| `--dry-run`                                                      | `-n`  | boolean | false         | केवल तैयारी करें, execute न करें                                                                                                                                                                                                                                                                                                                                                      |
| `--only-prepare-command`                                         |       | boolean | false         | केवल command तैयार करें और print करें                                                                                                                                                                                                                                                                                                                                                 |
| `--skip-tool-connection-check`                                   |       | boolean | false         | tool connection check छोड़ें                                                                                                                                                                                                                                                                                                                                                          |
| `--auto-pull-request-creation`                                   |       | boolean | true          | execution से पहले draft PR बनाएं                                                                                                                                                                                                                                                                                                                                                      |
| `--attach-logs`                                                  |       | boolean | false         | PR में logs संलग्न करें (संवेदनशील)                                                                                                                                                                                                                                                                                                                                                   |
| `--attach-solution-summary`                                      |       | boolean | false         | PR/issue comment के रूप में AI solution summary संलग्न करें                                                                                                                                                                                                                                                                                                                           |
| `--auto-attach-solution-summary`                                 |       | boolean | true          | केवल तभी summary auto-attach करें जब AI ने comments पोस्ट न किए हों (अक्षम करने के लिए `--no-auto-attach-solution-summary` उपयोग करें)                                                                                                                                                                                                                                                |
| `--auto-close-pull-request-on-fail`                              |       | boolean | false         | fail होने पर PR बंद करें                                                                                                                                                                                                                                                                                                                                                              |
| `--auto-continue`                                                |       | boolean | true          | मौजूदा PR के साथ continue करें                                                                                                                                                                                                                                                                                                                                                        |
| `--auto-resume-on-limit-reset`                                   |       | boolean | true          | limit reset होने पर auto-resume करें (session context बनाए रखता है)                                                                                                                                                                                                                                                                                                                   |
| `--auto-restart-on-limit-reset`                                  |       | boolean | false         | limit reset होने पर auto-restart करें (--resume के बिना fresh start)                                                                                                                                                                                                                                                                                                                  |
| `--auto-resume-on-errors`                                        |       | boolean | false         | network errors पर auto-resume करें                                                                                                                                                                                                                                                                                                                                                    |
| `--auto-continue-only-on-new-comments`                           |       | boolean | false         | कोई नए comments न हों तो fail करें                                                                                                                                                                                                                                                                                                                                                    |
| `--auto-commit-uncommitted-changes`                              |       | boolean | false         | changes auto-commit करें                                                                                                                                                                                                                                                                                                                                                              |
| `--auto-restart-on-uncommitted-changes`                          |       | boolean | true          | uncommitted changes पर auto-restart करें                                                                                                                                                                                                                                                                                                                                              |
| `--auto-restart-max-iterations`                                  |       | number  | 5             | रुकने से पहले अधिकतम auto-restart iterations (0 = unlimited)                                                                                                                                                                                                                                                                                                                          |
| `--auto-resume-max-iterations`                                   |       | number  | 5             | usage-limit resets के बाद अधिकतम automatic resume/restart continuations (0 = unlimited)                                                                                                                                                                                                                                                                                               |
| `--auto-merge`                                                   |       | boolean | false         | session समाप्त होने और CI pass होने पर PR auto-merge करें                                                                                                                                                                                                                                                                                                                             |
| `--auto-restart-until-mergeable`                                 |       | boolean | true          | PR mergeable होने तक auto-restart करें। billing limits का पता लगाता है और private repos के लिए comment के साथ रुकता है।                                                                                                                                                                                                                                                               |
| `--wait-for-all-actions-in-repository-before-mergeable`          |       | boolean | true          | PR को mergeable घोषित करने से पहले repo में सभी active GitHub Actions runs के पूरा होने की प्रतीक्षा करें। branch की परवाह किए बिना किसी भी active run पर block करता है ताकि CI/CD pipelines interact करने पर safety सुनिश्चित हो।                                                                                                                                                    |
| `--auto-restart-on-non-updated-pull-request-description`         |       | boolean | false         | PR description में placeholder text होने पर auto-restart करें                                                                                                                                                                                                                                                                                                                         |
| `--auto-merge-default-branch-to-pull-request-branch`             |       | boolean | false         | PR branch में default branch merge करें                                                                                                                                                                                                                                                                                                                                               |
| `--allow-fork-divergence-resolution-using-force-push-with-lease` |       | boolean | false         | fork divergence पर force-push की अनुमति दें                                                                                                                                                                                                                                                                                                                                           |
| `--allow-force-non-fork-repository-deletion`                     |       | boolean | false         | additional commits वाले non-fork repositories को भी हटाने की अनुमति दें (खतरनाक: data loss संभव)                                                                                                                                                                                                                                                                                      |
| `--allow-to-push-to-contributors-pull-requests-as-maintainer`    |       | boolean | false         | maintainer के रूप में contributor के fork में push करें                                                                                                                                                                                                                                                                                                                               |
| `--prefix-fork-name-with-owner-name`                             |       | boolean | true          | fork को owner name से prefix करें                                                                                                                                                                                                                                                                                                                                                     |
| `--continue-only-on-feedback`                                    |       | boolean | false         | केवल feedback मिलने पर continue करें                                                                                                                                                                                                                                                                                                                                                  |
| `--watch`                                                        | `-w`  | boolean | false         | feedback के लिए monitor करें और auto-restart करें                                                                                                                                                                                                                                                                                                                                     |
| `--watch-interval`                                               |       | number  | 60            | feedback check interval (सेकंड)                                                                                                                                                                                                                                                                                                                                                       |
| `--min-disk-space`                                               |       | number  | 2048          | MB में न्यूनतम disk space                                                                                                                                                                                                                                                                                                                                                             |
| `--log-dir`                                                      | `-l`  | string  | (cwd)         | log files के लिए directory                                                                                                                                                                                                                                                                                                                                                            |
| `--sentry`                                                       |       | boolean | false         | Sentry त्रुटि ट्रैकिंग सक्षम करें (privacy के लिए डिफ़ॉल्ट रूप से अक्षम; opt in के लिए --sentry उपयोग करें)                                                                                                                                                                                                                                                                           |
| `--auto-accept-invite`                                           |       | boolean | true          | write access जांचने से पहले target repository के लिए pending GitHub repo/org invitation auto-accept करें (अक्षम करने के लिए `--no-auto-accept-invite` उपयोग करें)                                                                                                                                                                                                                     |
| `--auto-report-issue`                                            |       | boolean | false         | prompt किए बिना failure पर automatically GitHub issue बनाएं (त्रुटि विवरण और logs सहित)                                                                                                                                                                                                                                                                                               |
| `--disable-report-issue`                                         |       | boolean | false         | त्रुटि issue निर्माण पूरी तरह अक्षम करें (--auto-report-issue को override करता है)                                                                                                                                                                                                                                                                                                    |
| `--auto-cleanup`                                                 |       | boolean | (varies)      | completion पर temp directory हटाएं                                                                                                                                                                                                                                                                                                                                                    |
| `--claude-file`                                                  |       | boolean | false         | task details के लिए CLAUDE.md बनाएं (--gitkeep-file के साथ exclusive)                                                                                                                                                                                                                                                                                                                 |
| `--gitkeep-file`                                                 |       | boolean | true          | CLAUDE.md के बजाय .gitkeep बनाएं (सभी --tool values के लिए डिफ़ॉल्ट, --claude-file के साथ exclusive)                                                                                                                                                                                                                                                                                  |
| `--auto-gitkeep-file`                                            |       | boolean | true          | CLAUDE.md .gitignore में हो तो auto .gitkeep उपयोग करें                                                                                                                                                                                                                                                                                                                               |
| `--execute-tool-with-bun`                                        |       | boolean | false         | bunx का उपयोग करके AI tool execute करें (experimental)                                                                                                                                                                                                                                                                                                                                |
| `--enable-workspaces`                                            |       | boolean | false         | अलग workspace directory structure उपयोग करें (experimental)                                                                                                                                                                                                                                                                                                                           |
| `--interactive-mode`                                             |       | boolean | false         | [EXPERIMENTAL] output को PR comments के रूप में post करें                                                                                                                                                                                                                                                                                                                             |
| `--prompt-plan-sub-agent`                                        |       | boolean | false         | planning के लिए Plan sub-agent उपयोग करें                                                                                                                                                                                                                                                                                                                                             |
| `--prompt-explore-sub-agent`                                     |       | boolean | false         | Explore sub-agent उपयोग करें                                                                                                                                                                                                                                                                                                                                                          |
| `--prompt-general-purpose-sub-agent`                             |       | boolean | false         | सामान्य-उद्देश्य sub agents उपयोग करें                                                                                                                                                                                                                                                                                                                                                |
| `--tokens-budget-stats`                                          |       | boolean | true          | token budget statistics दिखाएं (अक्षम करने के लिए `--no-tokens-budget-stats` उपयोग करें)                                                                                                                                                                                                                                                                                              |
| `--prompt-issue-reporting`                                       |       | boolean | false         | देखे गए bugs के लिए auto-create issues                                                                                                                                                                                                                                                                                                                                                |
| `--prompt-case-studies`                                          |       | boolean | false         | case study documentation बनाएं                                                                                                                                                                                                                                                                                                                                                        |
| `--prompt-architecture-care`                                     |       | boolean | false         | [EXPERIMENTAL] REQUIREMENTS.md और ARCHITECTURE.md प्रबंधित करें                                                                                                                                                                                                                                                                                                                       |
| `--prompt-playwright-mcp`                                        |       | boolean | true          | Playwright MCP hints (केवल तभी जब MCP इंस्टॉल हो, अक्षम करने के लिए `--no-prompt-playwright-mcp` उपयोग करें)                                                                                                                                                                                                                                                                          |
| `--prompt-check-sibling-pull-requests`                           |       | boolean | true          | संबंधित कार्य का अध्ययन करते समय sibling PRs जांचें (अक्षम करने के लिए `--no-prompt-check-sibling-pull-requests` उपयोग करें)                                                                                                                                                                                                                                                          |
| `--prompt-experiments-folder`                                    |       | string  | ./experiments | experiments folder का पथ (अक्षम करने के लिए खाली करें)                                                                                                                                                                                                                                                                                                                                |
| `--prompt-examples-folder`                                       |       | string  | ./examples    | examples folder का पथ (अक्षम करने के लिए खाली करें)                                                                                                                                                                                                                                                                                                                                   |
| `--playwright-mcp-auto-cleanup`                                  |       | boolean | true          | uncommitted check से पहले .playwright-mcp/ folder auto-remove करें                                                                                                                                                                                                                                                                                                                    |
| `--auto-gh-configuration-repair`                                 |       | boolean | false         | gh-setup-git-identity का उपयोग करके git config auto-repair करें                                                                                                                                                                                                                                                                                                                       |
| `--auto-init-repository`                                         |       | boolean | false         | README.md बनाकर खाली repositories automatically initialize करें, commits न होने वाले repos पर branch creation सक्षम करें                                                                                                                                                                                                                                                              |
| `--prompt-ensure-all-requirements-are-met`                       |       | boolean | false         | [EXPERIMENTAL] यह सुनिश्चित करने के लिए prompt hint जोड़ें कि सभी changes सभी discussed requirements पूरे करते हों                                                                                                                                                                                                                                                                    |
| `--prompt-subagents-via-agent-commander`                         |       | boolean | false         | subagent delegation के लिए agent-commander उपयोग करें (installation आवश्यक)                                                                                                                                                                                                                                                                                                           |
| `--finalize`                                                     |       | number  | 0             | [EXPERIMENTAL] solve पूरा होने के बाद, AI को N बार requirements-check prompt के साथ restart करें                                                                                                                                                                                                                                                                                      |
| `--finalize-model`                                               |       | string  |               | [EXPERIMENTAL] --finalize iterations के लिए model override (--model पर defaults)                                                                                                                                                                                                                                                                                                      |
| `--working-session-live-progress`                                |       | string  | false         | [EXPERIMENTAL] Live progress monitoring: "comment" (per-session PR comment) या "pr" (PR description update करता है)                                                                                                                                                                                                                                                                   |

### hive विकल्प

```bash
hive <github-url> [options]
```

| विकल्प                                 | Alias | प्रकार  | डिफ़ॉल्ट      | विवरण                                                                                                                                 |
| -------------------------------------- | ----- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--monitor-tag`                        | `-t`  | string  | "help wanted" | monitor करने के लिए label                                                                                                             |
| `--all-issues`                         | `-a`  | boolean | false         | सभी issues monitor करें (labels अनदेखा करें)                                                                                          |
| `--skip-issues-with-prs`               | `-s`  | boolean | false         | मौजूदा PRs वाले issues छोड़ें                                                                                                         |
| `--concurrency`                        | `-c`  | number  | 2             | Parallel workers                                                                                                                      |
| `--pull-requests-per-issue`            | `-p`  | number  | 1             | प्रति issue PRs की संख्या                                                                                                             |
| `--model`                              | `-m`  | string  | sonnet        | उपयोग करने के लिए model                                                                                                               |
| `--tool`                               |       | string  | claude        | AI tool (claude, opencode, agent)                                                                                                     |
| `--interval`                           | `-i`  | number  | 300           | Poll interval (सेकंड)                                                                                                                 |
| `--max-issues`                         |       | number  | 0             | प्रोसेस किए गए issues सीमित करें (0 = असीमित)                                                                                         |
| `--once`                               |       | boolean | false         | Single run (monitor न करें)                                                                                                           |
| `--dry-run`                            |       | boolean | false         | Processing के बिना issues सूचीबद्ध करें                                                                                               |
| `--skip-tool-connection-check`         |       | boolean | false         | tool connection check छोड़ें                                                                                                          |
| `--verbose`                            | `-v`  | boolean | false         | verbose logging सक्षम करें                                                                                                            |
| `--min-disk-space`                     |       | number  | 2048          | MB में न्यूनतम disk space                                                                                                             |
| `--auto-cleanup`                       |       | boolean | false         | success पर temp directories साफ़ करें                                                                                                 |
| `--fork`                               | `-f`  | boolean | false         | write access न होने पर repos fork करें                                                                                                |
| `--auto-fork`                          |       | boolean | true          | public repos को automatically fork करें                                                                                               |
| `--auto-init-repository`               |       | boolean | false         | README.md बनाकर खाली repos auto-initialize करें (solve को पास किया जाता है)                                                           |
| `--auto-accept-invite`                 |       | boolean | true          | target repository के लिए pending GitHub repo/org invitation auto-accept करें (अक्षम करने के लिए `--no-auto-accept-invite` उपयोग करें) |
| `--attach-logs`                        |       | boolean | false         | PRs में logs संलग्न करें (संवेदनशील)                                                                                                  |
| `--attach-solution-summary`            |       | boolean | false         | comment के रूप में AI solution summary संलग्न करें                                                                                    |
| `--auto-attach-solution-summary`       |       | boolean | true          | कोई AI comments न हों तो summary auto-attach करें (अक्षम करने के लिए `--no-auto-attach-solution-summary` उपयोग करें)                  |
| `--project-number`                     | `-pn` | number  |               | monitor करने के लिए GitHub Project number                                                                                             |
| `--project-owner`                      | `-po` | string  |               | GitHub Project owner                                                                                                                  |
| `--project-status`                     | `-ps` | string  | "Ready"       | monitor करने के लिए Project status column                                                                                             |
| `--project-mode`                       | `-pm` | boolean | false         | project-based monitoring सक्षम करें                                                                                                   |
| `--youtrack-mode`                      |       | boolean | false         | YouTrack mode सक्षम करें                                                                                                              |
| `--youtrack-stage`                     |       | string  |               | YouTrack stage override करें                                                                                                          |
| `--youtrack-project`                   |       | string  |               | YouTrack project code override करें                                                                                                   |
| `--target-branch`                      | `-tb` | string  | (default)     | PRs के लिए target branch                                                                                                              |
| `--log-dir`                            | `-l`  | string  | (cwd)         | log files के लिए directory                                                                                                            |
| `--auto-continue`                      |       | boolean | true          | solve को --auto-continue पास करें                                                                                                     |
| `--auto-resume-on-limit-reset`         |       | boolean | true          | limit reset होने पर auto-resume करें (solve को पास किया जाता है)                                                                      |
| `--think`                              |       | string  |               | Thinking level (low, medium, high, max)                                                                                               |
| `--prompt-plan-sub-agent`              |       | boolean | false         | Plan sub-agent उपयोग करें                                                                                                             |
| `--sentry`                             |       | boolean | false         | Sentry त्रुटि ट्रैकिंग सक्षम करें (privacy के लिए डिफ़ॉल्ट रूप से अक्षम; opt in के लिए --sentry उपयोग करें)                           |
| `--watch`                              | `-w`  | boolean | false         | feedback के लिए monitor करें और auto-restart करें                                                                                     |
| `--issue-order`                        | `-o`  | string  | "asc"         | issues को date द्वारा order करें (asc, desc)                                                                                          |
| `--prefix-fork-name-with-owner-name`   |       | boolean | true          | fork को owner name से prefix करें                                                                                                     |
| `--interactive-mode`                   |       | boolean | false         | [EXPERIMENTAL] output को PR comments के रूप में post करें                                                                             |
| `--prompt-explore-sub-agent`           |       | boolean | false         | Explore sub-agent उपयोग करें                                                                                                          |
| `--prompt-general-purpose-sub-agent`   |       | boolean | false         | सामान्य-उद्देश्य sub agents उपयोग करें                                                                                                |
| `--tokens-budget-stats`                |       | boolean | true          | token budget statistics दिखाएं (अक्षम करने के लिए `--no-tokens-budget-stats` उपयोग करें)                                              |
| `--prompt-issue-reporting`             |       | boolean | false         | देखे गए bugs के लिए auto-create issues                                                                                                |
| `--prompt-case-studies`                |       | boolean | false         | case study documentation बनाएं                                                                                                        |
| `--prompt-playwright-mcp`              |       | boolean | true          | Playwright MCP hints (केवल तभी जब इंस्टॉल हो)                                                                                         |
| `--prompt-check-sibling-pull-requests` |       | boolean | true          | संबंधित कार्य का अध्ययन करते समय sibling PRs जांचें                                                                                   |

### hive-telegram-bot विकल्प

```bash
hive-telegram-bot [options]
```

| विकल्प                              | Alias | प्रकार  | डिफ़ॉल्ट   | विवरण                                                                                                                                                                                                       |
| ----------------------------------- | ----- | ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--token`                           | `-t`  | string  | (आवश्यक)   | @BotFather से Telegram bot token                                                                                                                                                                            |
| `--allowed-chats`                   |       | string  | (सभी)      | अनुमत chat IDs (Links Notation)                                                                                                                                                                             |
| `--solve-overrides`                 |       | string  | (कोई नहीं) | /solve के लिए override विकल्प                                                                                                                                                                               |
| `--hive-overrides`                  |       | string  | (कोई नहीं) | /hive के लिए override विकल्प                                                                                                                                                                                |
| `--solve`                           |       | boolean | true       | /solve command सक्षम करें (अक्षम करने के लिए --no-solve)                                                                                                                                                    |
| `--hive`                            |       | boolean | true       | /hive command सक्षम करें (अक्षम करने के लिए --no-hive)                                                                                                                                                      |
| `--configuration`                   | `-c`  | string  |            | LINO configuration string                                                                                                                                                                                   |
| `--verbose`                         | `-v`  | boolean | false      | verbose logging सक्षम करें                                                                                                                                                                                  |
| `--dry-run`                         |       | boolean | false      | bot शुरू किए बिना validate करें                                                                                                                                                                             |
| `--auto-start-screen-watch-message` |       | boolean | false      | Experimental: public `/solve` sessions के लिए अलग `/terminal_watch` message auto-start करें। Private या unknown-visibility repositories में watch messages auto-start नहीं होते।                            |
| `--isolation`                       |       | string  | `screen`   | Isolation backend (`screen`, `tmux`, `docker`)। डिफ़ॉल्ट `screen` ताकि Telegram-bot work sessions bot restart के बाद भी detached रहें। opt out के लिए `--isolation ''` (या `TELEGRAM_ISOLATION=`) पास करें। |

जब `/solve` सक्षम हो, Telegram bot `/do` और `/continue` को सामान्य `/solve`
aliases के रूप में भी स्वीकार करता है। `/claude`, `/codex`, `/opencode`, और
`/agent` per-tool aliases हैं, जो क्रमशः `/solve --tool claude`,
`/solve --tool codex`, `/solve --tool opencode`, और `/solve --tool agent`
के बराबर हैं।

---

## उपयोग के उदाहरण

### Environment Variables सेट करना

```bash
# Claude timeout 2 मिनट तक बढ़ाएं
export HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=120

# तेज़ operations के लिए GitHub API delay कम करें
export HIVE_MIND_GITHUB_API_DELAY_MS=2000

# auto-continue threshold 48 घंटे तक बढ़ाएं
export HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=48

# custom temporary directory उपयोग करें
export HIVE_MIND_TEMP_DIR=/var/tmp/hive-mind

# Sentry त्रुटि ट्रैकिंग सक्षम करें (डिफ़ॉल्ट रूप से अक्षम)
export HIVE_MIND_SENTRY=true

# GitHub Enterprise के लिए कॉन्फ़िगर करें
export HIVE_MIND_GITHUB_BASE_URL=https://github.enterprise.com
```

### Custom कॉन्फ़िगरेशन के साथ चलाएं

```bash
# custom timeouts के साथ चलाएं
HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=120 HIVE_MIND_RETRY_BASE_DELAY_MS=10000 hive https://github.com/owner/repo

# बढ़ी हुई सीमाओं के साथ चलाएं
HIVE_MIND_GITHUB_FILE_MAX_SIZE=52428800 HIVE_MIND_MIN_DISK_SPACE_MB=1000 solve https://github.com/owner/repo/issues/123

# custom auto-continue सेटिंग्स के साथ चलाएं (--auto-continue डिफ़ॉल्ट रूप से सक्षम है)
HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=12 solve https://github.com/owner/repo/issues/456
```

### कॉन्फ़िगरेशन फ़ाइल (वैकल्पिक)

आप अपने project root में `.env` फ़ाइल बना सकते हैं:

```bash
# .env file
HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=90
HIVE_MIND_GITHUB_API_DELAY_MS=3000
HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=36
HIVE_MIND_TEMP_DIR=/opt/hive-mind/tmp
HIVE_MIND_SENTRY_DSN=your-custom-sentry-dsn
```

फिर चलाने से पहले इसे source करें:

```bash
source .env
hive https://github.com/owner/repo
```

### Developer उपयोग

```javascript
import { timeouts, githubLimits, sentry } from './config.lib.mjs';

// कॉन्फ़िगरेशन मान उपयोग करें
const timeout = timeouts.claudeCli;
const maxSize = githubLimits.fileMaxSize;
const dsn = sentry.dsn;
```

---

## नोट्स

- सभी timeout मान milliseconds में हैं जब तक अन्यथा निर्दिष्ट न हो
- सभी size limits bytes में हैं जब तक अन्यथा निर्दिष्ट न हो
- Sample rates 0.0 और 1.0 के बीच होनी चाहिए
