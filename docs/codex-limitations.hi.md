# Codex Tool की सीमाएं (languages: [en](codex-limitations.md) • [zh](codex-limitations.zh.md) • hi • [ru](codex-limitations.ru.md))

## नेटवर्क प्रतिबंध

Codex tool सुरक्षा कारणों से प्रतिबंधित नेटवर्क एक्सेस के साथ sandboxed environment में चलता है।

### इसका क्या अर्थ है

1. **GitHub पर Push नहीं कर सकता**: Codex सीधे `git push` नहीं चला सकता
2. **बाहरी Resources Fetch नहीं कर सकता**: बाहरी APIs तक सीमित पहुंच
3. **Network Commands नहीं चला सकता**: `curl`, `wget` जैसे commands विफल हो सकते हैं

### solve.mjs इसे कैसे संभालता है

Solve script इन सीमाओं के आसपास काम करती है:

1. **प्रारंभिक सेटअप**: solve.mjs repo clone करता है और branch सेट करता है (codex चलने से पहले)
2. **Codex Execution**: Codex फ़ाइलें बनाता और संशोधित करता है, locally commit करता है
3. **Auto-Restart**: यदि codex uncommitted changes छोड़ता है, तो solve.mjs codex को स्वचालित रूप से restart करता है
4. **Final Push**: Codex पूरा होने के बाद, solve.mjs GitHub पर changes push करता है (sandbox के बाहर)

### अपेक्षित Workflow

```
[solve.mjs] Clone repo and create branch
            ↓
[codex]     Make changes and commit locally
            ↓
[solve.mjs] Detect uncommitted changes? → Restart codex
            ↓
[codex]     Commit remaining changes
            ↓
[solve.mjs] Push all commits to GitHub
            ↓
[solve.mjs] Exit successfully
```

### समस्या निवारण

यदि आप codex output में "Could not resolve host: github.com" देखते हैं:

- ✅ यह अपेक्षित और सामान्य है
- ✅ solve.mjs codex पूरा होने के बाद push संभाल लेगा
- ⚠️ Ctrl+C से बाधित न करें - प्रक्रिया पूरी होने दें

यदि codex पूरा होने के बाद solve.mjs push नहीं करता:

- जाँचें कि क्या आपने प्रक्रिया जल्दी बाधित की थी
- Manually push करें: `git push origin <branch-name>`
- यदि लगातार fail होता है तो bug के रूप में रिपोर्ट करें

## Auto-Restart बनाम Watch Mode

### Auto-Restart (अस्थायी Monitoring)

जब codex या अन्य tools uncommitted changes छोड़ते हैं, तो solve.mjs स्वचालित रूप से "Auto-Restart Mode" में प्रवेश करता है:

- **उद्देश्य**: पिछले run से अधूरे काम को पूरा करना
- **Trigger**: Tool execution के बाद uncommitted changes पता लगाना
- **अवधि**: एक बार चलता है, changes commit होने के बाद बाहर निकलता है
- **यह नहीं है**: User-requested `--watch` mode

**उदाहरण Output:**

```
🔄 AUTO-RESTART: Uncommitted changes detected
   Starting temporary monitoring cycle (NOT --watch mode)
   The tool will run once more to commit the changes
   Will exit automatically after changes are committed

🔄 AUTO-RESTART MODE ACTIVE
   Purpose: Complete unfinished work from previous run
   Monitoring PR: #123
   Mode: Temporary (NOT user-requested --watch)
```

### Watch Mode (निरंतर Monitoring)

जब आप स्पष्ट रूप से `--watch` उपयोग करते हैं, तो solve.mjs feedback के लिए निरंतर monitor करता है:

- **उद्देश्य**: PR पर user feedback के लिए निरंतर monitoring
- **Trigger**: User `--watch` flag निर्दिष्ट करता है
- **अवधि**: PR merge होने या Ctrl+C तक अनिश्चित काल तक चलता है
- **उपयोग का मामला**: Feedback के लिए दीर्घकालिक monitoring

**उदाहरण Output:**

```
👁️ WATCH MODE ACTIVATED
   Checking interval: 60 seconds
   Monitoring PR: #123
   Stop condition: PR merged by maintainer
```

### मुख्य अंतर

| विशेषता        | Auto-Restart                    | Watch Mode              |
| -------------- | ------------------------------- | ----------------------- |
| सक्रियण     | स्वचालित (uncommitted changes) | Manual (`--watch` flag) |
| अवधि       | एकल cycle                    | निरंतर              |
| उद्देश्य        | अधूरा काम पूरा करना          | Feedback के लिए monitor    |
| बाहर निकलने की शर्त | Changes committed               | PR merged या Ctrl+C     |

## सामान्य समस्याएं

### समस्या: "Watch mode activated but I didn't use --watch"

**स्पष्टीकरण**: यह Auto-Restart mode है, user-requested watch mode नहीं।

**कारण**: Tool ने uncommitted changes छोड़े जिन्हें संभालने की आवश्यकता है।

**समाधान**: प्रक्रिया पूरी होने दें। Changes commit होने के बाद यह स्वचालित रूप से बाहर निकल जाएगा।

### समस्या: "Codex can't push to GitHub"

**स्पष्टीकरण**: Codex network access के बिना sandboxed environment में चलता है।

**कारण**: Codex execution environment में सुरक्षा प्रतिबंध।

**समाधान**: Codex पूरा होने के बाद solve.mjs स्वचालित रूप से changes push करेगा। प्रक्रिया बाधित न करें।

### समस्या: "Process seems stuck in watch mode"

**स्पष्टीकरण**: या तो Auto-Restart changes commit होने की प्रतीक्षा कर रहा है, या आपने `--watch` उपयोग किया है।

**Debugging**:

1. Log messages जाँचें - क्या यह "AUTO-RESTART MODE" या "WATCH MODE ACTIVATED" कहता है?
2. यदि Auto-Restart: जाँचें कि क्या अभी भी uncommitted changes हैं
3. यदि Watch Mode: आपने `--watch` flag उपयोग किया है, PR merge की प्रतीक्षा करें या Ctrl+C दबाएं

**समाधान**:

- Auto-Restart के लिए: इसे पूरा होने दें या manually changes commit करें
- Watch Mode के लिए: पूरा होने की प्रतीक्षा करें या Ctrl+C से बाधित करें

## संबंधित दस्तावेज़ीकरण

- [Main README](../README.md) - सामान्य उपयोग और विशेषताएं
- [Case Study: Issue #642](../case-studies/issue-642-codex-watch-mode-and-network/README.md) - Watch mode behavior का विस्तृत विश्लेषण
