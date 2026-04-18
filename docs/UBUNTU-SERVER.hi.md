# Ubuntu 24.04 Server पर Installation (अप्रचलित) (languages: [en](UBUNTU-SERVER.md) • [zh](UBUNTU-SERVER.zh.md) • hi • [ru](UBUNTU-SERVER.ru.md))

> ⚠️ **अप्रचलित:** यह installation विधि अब अनुशंसित नहीं है।
>
> **हम अब developer machines और servers दोनों पर सभी installations के लिए Docker का उपयोग करने की सलाह देते हैं।**
> Docker बेहतर अलगाव, आसान प्रबंधन, और सुसंगत वातावरण प्रदान करता है।
>
> कृपया इसके बजाय [Docker installation विधि](../README.hi.md#using-docker) का उपयोग करें।
> Kubernetes deployments के लिए, [Helm installation](../README.hi.md#helm-installation-kubernetes) देखें।
> विस्तृत Docker उपयोग के लिए, [docs/DOCKER.hi.md](./DOCKER.hi.md) देखें।

---

निम्नलिखित निर्देश Ubuntu 24.04 server पर legacy bare-metal installation का वर्णन करते हैं। यह दृष्टिकोण केवल संदर्भ के लिए रखा गया है।

> **नोट:** Issue #1639 के अनुसार, `ubuntu-24-server-install.sh` script को repository से हटा दिया गया है।
> Docker image अब base image के रूप में `konard/box` (एक विशिष्ट संस्करण पर pinned) का उपयोग करता है, जो सभी development tools प्रदान करता है।
> ऐतिहासिक संदर्भ के लिए, script का अंतिम संस्करण यहां उपलब्ध है:
> https://github.com/link-foundation/box/blob/v2.0.1/scripts/ubuntu-24-server-install.sh

## चरण

1. ताज़े Ubuntu 24.04 के साथ VPS/VDS server reset/install करें
2. `root` user में Login करें।
3. पहले Box install करें (सभी development tools प्रदान करता है)

   ```bash
   # विकल्प 1: Docker का उपयोग करें (अनुशंसित)
   docker pull konard/box:2.0.1
   docker run -it konard/box:2.0.1

   # विकल्प 2: Box install script का उपयोग करें (v2.0.1 release commit पर pinned)
   curl -fsSL -o- https://raw.githubusercontent.com/link-foundation/box/v2.0.1/scripts/ubuntu-24-server-install.sh | bash
   ```

   **नोट:** Installation स्वचालित रूप से `gh auth login` नहीं चलाता। यह Docker builds को timeouts के बिना support करने के लिए जानबूझकर किया गया है। Authentication अगले चरणों में की जाती है।

4. `box` user में Login करें

   ```bash
   su - box
   ```

5. **महत्वपूर्ण:** Installation पूर्ण होने के AFTER GitHub CLI के साथ authenticate करें

   ```bash
   gh-setup-git-identity
   ```

   नोट: अपने GitHub account के साथ authenticate करने के लिए prompts का पालन करें। यह gh tool के काम करने के लिए आवश्यक है, और सिस्टम इस GitHub account का उपयोग करके सभी actions करेगा। Docker वातावरण में build timeouts से बचने के लिए यह चरण installation script पूर्ण होने के बाद किया जाना चाहिए।

6. Claude Code CLI, OpenCode AI CLI, और @link-assistant/agent पिछले script के साथ preinstalled हैं। अब आपको यह सुनिश्चित करना होगा कि claude authorized है। claude command execute करें, और local claude को authorize करने के लिए सभी चरणों का पालन करें

   ```bash
   claude
   ```

   नोट: opencode और agent दोनों default रूप से मुफ्त Grok Code Fast 1 model के साथ आते हैं - इसलिए इन tools के लिए कोई authorization आवश्यक नहीं है।

7. Hive Mind telegram bot launch करें:

   **Links Notation का उपयोग करके (अनुशंसित):**

   ```
   screen -R bot # bot के लिए नया screen दर्ज करें

   hive-telegram-bot --configuration "
     TELEGRAM_BOT_TOKEN: '849...355:AAG...rgk_YZk...aPU'
     TELEGRAM_ALLOWED_CHATS:
       -1002975819706
       -1002861722681
     TELEGRAM_HIVE_OVERRIDES:
       --all-issues
       --once
       --skip-issues-with-prs
       --attach-logs
       --verbose
       --no-tool-check
     TELEGRAM_SOLVE_OVERRIDES:
       --attach-logs
       --verbose
       --no-tool-check
     TELEGRAM_BOT_VERBOSE: true
   "

   # screen से detach करने के लिए CTRL + A + D दबाएं
   ```

   **अलग-अलग command-line options का उपयोग करके:**

   ```
   screen -R bot # bot के लिए नया screen दर्ज करें

   hive-telegram-bot --token 849...355:AAG...rgk_YZk...aPU --allowed-chats "(
     -1002975819706
     -1002861722681
   )" --hive-overrides "(
     --all-issues
     --once
     --skip-issues-with-prs
     --attach-logs
     --verbose
     --no-tool-check
   )" --solve-overrides "(
     --attach-logs
     --verbose
     --no-tool-check
   )" --verbose

   # screen से detach करने के लिए CTRL + A + D दबाएं
   ```

   नोट: bot token प्राप्त करने के लिए आपको https://t.me/BotFather के साथ अपना खुद का bot register करना पड़ सकता है।

## Codex sign-in

1. SSH के साथ tunnel खुले रखते हुए Hive Mind installed अपने VPS instance से connect करें

```bash
ssh -L 1455:localhost:1455 root@123.123.123.123
```

2. Codex login oAuth server शुरू करें:

```bash
codex login
```

1455 port पर oAuth callback server शुरू हो जाएगा, और oAuth का link print होगा, link copy करें।

3. उस machine पर अपने browser का उपयोग करें जहां से आपने tunnel शुरू किया, वहां `codex login` command से link paste करें, और अपने browser का उपयोग करके वहां जाएं। एक बार localhost:1455 पर redirect होने पर आप successful login page देखेंगे, और `codex login` में आप `Successfully logged in` देखेंगे। उसके बाद `codex login` command पूर्ण हो जाएगा, और आप verify करने के लिए हमेशा की तरह `codex` command का उपयोग कर सकते हैं। यह `solve` और `hive` commands में `--tool codex` के साथ भी काम करना चाहिए।
