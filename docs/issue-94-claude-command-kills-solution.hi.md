# Issue #94 का समाधान सारांश: Claude Command Kill हो रहा था (languages: [en](issue-94-claude-command-kills-solution.md) • [zh](issue-94-claude-command-kills-solution.zh.md) • hi • [ru](issue-94-claude-command-kills-solution.ru.md))

## किए गए परिवर्तन

### 1. **Claude Execution से पहले Memory जाँच**

- `/proc/meminfo` से उपलब्ध memory जाँचने वाला `checkMemory()` function जोड़ा गया
- Claude शुरू करने से पहले कम से कम 256MB उपलब्ध memory की जाँच करता है
- अपर्याप्त memory होने पर Ubuntu 24.04 swap वृद्धि के उपयोगी निर्देश प्रदान करता है
- Process में जल्दी call किया जाता है ताकि memory बहुत कम होने पर Claude शुरू होने से रोका जा सके

### 2. **System Resource Monitoring**

- System state capture करने के लिए `getResourceSnapshot()` function जोड़ा गया
- Claude execution से पहले और विफलता पर resource snapshots लेता है
- Memory, CPU load, और uptime जानकारी log करता है
- यह diagnose करने में मदद करता है कि Claude को क्यों kill किया गया

### 3. **बेहतर Process Kill Detection**

- Kill signals (SIGKILL, SIGTERM, आदि) पहचानने के लिए stderr monitoring बढ़ाया गया
- Memory-related kills (OOM, "killed", आदि) के लिए विशेष detection जोड़ी गई
- विस्तृत exit code स्पष्टीकरण प्रदान करता है:
  - Exit code 137: SIGKILL (संभवतः memory constraints)
  - Exit code 139: SIGSEGV (segmentation fault)
  - Exit code 143: SIGTERM (terminated)

### 4. **Sonnet Model के साथ Claude CLI Connection**

- `solve.mjs` और `hive.mjs` दोनों को connection checks के लिए `--model sonnet` उपयोग करने के लिए अपडेट किया गया
- यह सुनिश्चित करता है कि connection tests संभावित महंगे default के बजाय सबसे सस्ते model का उपयोग करें
- सभी तीन connection check commands में बदलाव किए गए:
  - `printf hi | claude --model sonnet -p`
  - `timeout 60 claude --model sonnet -p hi`
  - Error message अपडेट किया गया `claude --model sonnet -p hi` suggest करने के लिए

### 5. **बेहतर Error Handling और Logging**

- Claude command विफलता पर बेहतर resource monitoring
- Specific kill detection के साथ बेहतर error messages
- `--attach-logs` उपयोग होने पर विफलताओं के लिए बेहतर log attachment
- Command fail होने पर PR comments में failure logs जोड़े गए

### 6. **उचित Error Codes**

- सुनिश्चित करें कि सभी failure scenarios पर `process.exit(1)` call हो
- Main catch block में उचित error code handling जोड़ी गई
- पूरे system में clean error propagation बनाए रखें

## Root Cause Analysis

समस्या निम्न कारणों से हुई:

1. **कम memory**: System में Claude के लिए आवश्यक 256MB+ के विरुद्ध केवल ~56MB उपलब्ध memory थी
2. **अपर्याप्त swap**: केवल 512MB total swap, अधिकतर उपयोग में
3. **कोई early memory check नहीं**: Claude शुरू होता था और फिर OOM killer द्वारा kill हो जाता था
4. **महंगे connection checks**: Connection tests के लिए default model उपयोग करना

## परीक्षण

Solution का परीक्षण किया गया:

- विभिन्न thresholds पर Memory check functionality
- Resource snapshot संग्रह
- Error detection patterns
- कम memory scenario simulation

## Fix के बाद अपेक्षित Behavior

1. **Early Detection**: Claude शुरू होने से पहले Memory समस्याएं पहचानी जाती हैं
2. **स्पष्ट निर्देश**: Users को विशेष Ubuntu 24.04 swap वृद्धि commands मिलते हैं
3. **बेहतर Diagnostics**: जब Claude kill हो जाता है, users resource state और संभावित कारण देखते हैं
4. **लागत अनुकूलन**: Connection checks सबसे सस्ते sonnet model का उपयोग करते हैं
5. **उचित Failure Handling**: Failures उचित exit codes return करती हैं और logs संलग्न करती हैं

यह समाधान GitHub issue में उल्लिखित सभी पहलुओं को संबोधित करता है जबकि backward compatibility बनाए रखता है और resource constraints का सामना करने पर समग्र user experience में सुधार करता है।
