# Hive Mind में योगदान (languages: [en](CONTRIBUTING.md) • [zh](CONTRIBUTING.zh.md) • hi • [ru](CONTRIBUTING.ru.md))

## मानव-AI सहयोग दिशानिर्देश

यह प्रोजेक्ट मानव निगरानी के साथ AI-संचालित विकास का उपयोग करता है। इन प्रथाओं का पालन करें:

### विकास कार्यप्रवाह

1. **Issue बनाना** - मनुष्य स्पष्ट आवश्यकताओं के साथ issues बनाते हैं
2. **AI प्रसंस्करण** - Hive Mind विश्लेषण करता है और समाधान प्रस्तावित करता है
3. **मानव समीक्षा** - कोड समीक्षा और आर्किटेक्चरल निर्णय
4. **पुनरावृत्त सुधार** - सहयोगी सुधार चक्र

### कोड मानक

- **TypeScript/JavaScript**: सख्त टाइपिंग आवश्यक
- **फ़ाइल आकार**: प्रति फ़ाइल अधिकतम 1000 लाइनें
- **परीक्षण**: महत्वपूर्ण पथों के लिए 100% टेस्ट कवरेज
- **दस्तावेज़ीकरण**: मशीन-पठनीय, टोकन-कुशल

### Changesets के साथ संस्करण प्रबंधन

यह प्रोजेक्ट संस्करणों और changelogs को प्रबंधित करने के लिए [Changesets](https://github.com/changesets/changesets) का उपयोग करता है। इससे वे merge conflicts समाप्त हो जाते हैं जो तब उत्पन्न होते हैं जब एकाधिक PRs package.json में संस्करण बढ़ाते हैं।

#### Changeset जोड़ना

जब आप ऐसे बदलाव करें जो उपयोगकर्ताओं को प्रभावित करते हैं, तो एक changeset जोड़ें:

```bash
npm run changeset
```

यह आपसे निम्नलिखित के लिए संकेत करेगा:

1. परिवर्तन का प्रकार चुनें (patch/minor/major)
2. परिवर्तनों का सारांश प्रदान करें

Changeset `.changeset/` में एक markdown फ़ाइल के रूप में सहेजा जाएगा और इसे आपके PR के साथ commit किया जाना चाहिए।

#### Changeset दिशानिर्देश

- **Patch**: बग फिक्स, दस्तावेज़ीकरण अपडेट, आंतरिक refactoring
- **Minor**: नई सुविधाएं, गैर-breaking संवर्द्धन
- **Major**: Breaking changes जो public API को प्रभावित करते हैं

उदाहरण changeset सारांश:

```markdown
Add support for automatic fork creation with --auto-fork flag
```

#### रिलीज़ प्रक्रिया

1. जब changesets वाला PR main में merge होता है, तो Release workflow `changeset version` चलाता है और version bump, अपडेट किया गया CHANGELOG.md तथा उपयोग की गई `.changeset/*.md` फ़ाइलें `github-actions[bot]` के रूप में **सीधे main में commit** करता है
2. वही run पैकेज को NPM पर प्रकाशित करता है और GitHub release बनाता है
3. कोई "Version Packages" या `release/*` PR नहीं बनाया जाता: हर release के लिए एक अतिरिक्त PR और एक न हटाई जा सकने वाली branch बनती थी, और विफल run एक पुराना release PR छोड़ जाता था (issue #2402)। यदि कोई repository rule push को अस्वीकार करता है, तो release rule के आउटपुट के साथ विफल होता है; rule ठीक करें, release PR न जोड़ें

### कोड changelog नहीं है

Release इतिहास `.changeset/*.md`, बनाए गए `CHANGELOG.md`, GitHub releases, commit messages और code comments में रहता है। Runtime पर उपयोगकर्ता जो कुछ भी पढ़ता है, वह केवल यह बताता है कि **software अभी क्या करता है**: `--help` और usage स्क्रीन, option descriptions, console output, Telegram bot के जवाब और `src/locales/*.lino`, तथा tool द्वारा पोस्ट किए गए comments, issues और commits।

हम ऐसा कोड स्वीकार नहीं करते जो:

- बताता है कि क्या बदला: "पुराना व्यवहार", "नए संस्करणों में default", "अब X करता है", "अब Y नहीं करता", "legacy script को command बना दिया गया", "से नाम बदला गया", "vX.Y में नया", "What's new" banners या release notes
- उपयोगकर्ता को दिखने वाले टेक्स्ट पर उस issue या PR का टैग लगाता है जिसने इसे जोड़ा, जैसे "(issue #1234)", "(#594)" या "Reference: https://github.com/link-assistant/hive-mind/issues/1234"

लिखें कि option या संदेश आज क्या करता है। इतिहास changeset में, कारण code comment में, और issue link उस comment या test में रखें जो व्यवहार को तय करता है। Deprecation सूचनाएँ वर्तमान मार्गदर्शन हैं, इसलिए वे रहती हैं: वे विकल्प का नाम बताती हैं ("deprecated; use `--isolated screen`") और बदलाव की कहानी नहीं सुनातीं। Diagnostic log lines किसी ज्ञात विफलता का वर्णन करने वाले issue का हवाला दे सकती हैं, क्योंकि यह troubleshooting संकेत है, release इतिहास नहीं। `tests/no-changelog-in-ui-2402.test.mjs` help text, option descriptions, locales और GitHub पर पोस्ट की गई reports के लिए इसे लागू करता है।

### AI Agent कॉन्फ़िगरेशन

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

### गुणवत्ता गेट

merge से पहले, सुनिश्चित करें:

- [ ] सभी परीक्षण पास हों
- [ ] फ़ाइल आकार सीमाएं लागू हों
- [ ] टाइप चेकिंग पास हो
- [ ] मानव समीक्षा पूर्ण हो
- [ ] AI सहमति प्राप्त हो (यदि multi-agent)

### टेस्ट सूट एंट्रीपॉइंट

डिफ़ॉल्ट स्थानीय सूट के लिए `npm test` का उपयोग करें। जो नए परीक्षण
डिफ़ॉल्ट सूट में चलने चाहिए, उन्हें टेस्ट फ़ाइल में ही यह मार्कर रखना चाहिए:

```javascript
/**
 * @hive-mind-test-suite default
 */
```

जिन परीक्षणों को बाहरी सेवाओं की आवश्यकता होती है या जो वास्तविक
repositories को बदलते हैं, उनके लिए `github-integration` जैसे समर्पित suite
marker का उपयोग करें। `package.json` या मुख्य CI test-suite job में अलग-अलग
`node tests/...` commands न जोड़ें।

### संचार प्रोटोकॉल

#### मानव → AI

```bash
# स्पष्ट, विशिष्ट निर्देश
./solve.mjs https://github.com/owner/repo/issues/123 --requirements "Security focus, maintain backward compatibility"
```

#### AI → मानव

```bash
# कार्यसाधक items के साथ स्थिति रिपोर्ट
echo "🤖 Analysis complete. Requires human decision on breaking changes."
```

## AI Agents का परीक्षण

```typescript
import { testAgent } from './tests/agent-testing.ts';

// Agent व्यवहार का परीक्षण करें
await testAgent({
  scenario: 'complex-issue-solving',
  expectedOutcome: 'pull-request-created',
  timeout: 300000, // 5 मिनट
});
```

## कोड समीक्षा प्रक्रिया

1. **स्वचालित समीक्षा** - AI agents प्रारंभिक विश्लेषण करते हैं
2. **Cross-Agent सत्यापन** - कई agents समाधानों को सत्यापित करते हैं
3. **मानव निगरानी** - अंतिम आर्किटेक्चरल और सुरक्षा समीक्षा
4. **सहमति निर्माण** - चर्चा के माध्यम से संघर्षों का समाधान

### समीक्षा चेकलिस्ट

- [ ] एल्गोरिदम की शुद्धता सत्यापित
- [ ] सुरक्षा कमजोरियों का आकलन
- [ ] प्रदर्शन निहितार्थों पर विचार
- [ ] दस्तावेज़ीकरण की संपूर्णता
- [ ] एकीकरण परीक्षण कवरेज
