# शाखा सुरक्षा नीति (languages: [en](BRANCH_PROTECTION_POLICY.md) • [zh](BRANCH_PROTECTION_POLICY.zh.md) • hi • [ru](BRANCH_PROTECTION_POLICY.ru.md))

## अवलोकन

यह दस्तावेज़ hive-mind रिपॉजिटरी की `main` शाखा के लिए शाखा सुरक्षा नियमों और आवश्यक स्थिति जाँचों की रूपरेखा प्रस्तुत करता है। ये नियम कोड गुणवत्ता सुनिश्चित करते हैं, परिवर्तन-भंजक बदलावों को रोकते हैं, और एक स्थिर main शाखा बनाए रखते हैं।

## शाखा सुरक्षा क्यों?

शाखा सुरक्षा नियम निम्नलिखित को रोकते हैं:

- असफल परीक्षणों वाले pull requests को merge करना
- फ़ॉर्मेटिंग मानकों को पूरा न करने वाले कोड को merge करना
- CI द्वारा मान्य न किए गए बदलाव शामिल करना
- main शाखा पर अनजाने में force push करना
- महत्वपूर्ण जाँचें छोड़ी गई pull requests को merge करना

**देखें:** [Case Study: Issue #958](./case-studies/issue-958/ANALYSIS.md) — उचित शाखा सुरक्षा के बिना क्या हो सकता है, इसका वास्तविक उदाहरण।

## आवश्यक स्थिति जाँचें

`main` में सभी pull requests के लिए merge से पहले ये जाँचें पास होनी चाहिए:

### महत्वपूर्ण जाँचें (अवश्य पास होनी चाहिए)

1. **Changesets की जाँच** (`changeset-check`)
   - सुनिश्चित करता है कि प्रत्येक PR में संस्करण प्रबंधन के लिए एक changeset शामिल हो
   - केवल PRs पर चलता है, main शाखा के pushes पर नहीं
   - स्वचालित release PRs के लिए छोड़ दिया जाता है

2. **test-compilation**
   - सभी `.mjs` फ़ाइलों के लिए JavaScript सिंटैक्स मान्य करता है
   - सुनिश्चित करता है कि कोड सिंटैक्स त्रुटियों के बिना compile हो
   - तीव्र fail जाँच (~7-8 सेकंड)

3. **lint**
   - सभी लागू फ़ाइलों पर Prettier format जाँच चलाता है
   - ESLint कोड गुणवत्ता जाँचें चलाता है
   - कोड शैली की एकरूपता मान्य करता है
   - ~20-26 सेकंड runtime

4. **check-file-line-limits**
   - सुनिश्चित करता है कि कोई `.mjs` फ़ाइल 1500 पंक्तियों से अधिक न हो
   - कोड की मॉड्यूलरिटी और रखरखाव योग्यता को प्रोत्साहित करता है
   - तीव्र जाँच (~7 सेकंड)

5. **test-suites**
   - व्यापक परीक्षण suite चलाता है
   - मूल कार्यक्षमता मान्य करता है
   - ~3-4 मिनट runtime

6. **test-execution**
   - वास्तविक command execution परिदृश्यों का परीक्षण करता है
   - वास्तविक उपयोग पैटर्न मान्य करता है
   - ~2 मिनट runtime

7. **validate-docs**
   - सुनिश्चित करता है कि दस्तावेज़ीकरण फ़ाइलें मान्य हों
   - टूटे हुए लिंक या विकृत सामग्री की जाँच करता है
   - ~8-12 सेकंड runtime

8. **memory-check-linux**
   - मेमोरी लीक और अत्यधिक उपयोग के लिए परीक्षण करता है
   - प्रदर्शन मानकों को सुनिश्चित करता है
   - ~30 सेकंड runtime

### वैकल्पिक जाँचें (छोड़ी जा सकती हैं)

ये जाँचें इस आधार पर सशर्त रूप से चलती हैं कि कौन सी फ़ाइलें बदलीं:

- **docker-pr-check**: केवल तब चलता है जब Docker-संबंधित फ़ाइलें बदलती हैं
- **helm-pr-check**: बदले जाने पर Helm charts मान्य करता है
- **Release jobs**: केवल संस्करण bump commits पर चलती हैं

## कॉन्फ़िगरेशन चरण

### रिपॉजिटरी प्रशासकों के लिए

GitHub में ये नियम कॉन्फ़िगर करने के लिए:

1. **Settings** → **Branches** पर जाएं
2. `main` के लिए **Add rule** क्लिक करें या मौजूदा नियम संपादित करें
3. निम्नलिखित कॉन्फ़िगर करें:

#### बुनियादी सेटिंग्स

- ✅ **merge से पहले pull request आवश्यक है**
  - आवश्यक अनुमोदन: 0 (या सख्त नीति के लिए 1)
  - ✅ नए commits push होने पर पुराने PR अनुमोदन खारिज करें
  - ⬜ Code Owners की समीक्षा आवश्यक है (वैकल्पिक)
- ✅ **merge से पहले स्थिति जाँचें पास होनी चाहिए**
  - ✅ **merge से पहले शाखाएं अद्यतित होनी चाहिए**
  - निम्नलिखित स्थिति जाँचें चुनें:
    - `Check for Changesets`
    - `test-compilation`
    - `lint`
    - `check-file-line-limits`
    - `test-suites`
    - `test-execution`
    - `validate-docs`
    - `memory-check-linux`
- ✅ **merge से पहले वार्तालाप समाधान आवश्यक है** (अनुशंसित)
- ✅ **उपरोक्त सेटिंग्स को bypass करने की अनुमति न दें** (अनुशंसित)

#### अतिरिक्त सुरक्षाएं

- ⬜ **merge से पहले deployments सफल होना आवश्यक है** (लागू नहीं)
- ⬜ **शाखा lock करें** (अनुशंसित नहीं - सभी pushes रोकता है)
- ⬜ **linear history आवश्यक है** (वैकल्पिक - rebase या squash लागू करता है)

## जाँच स्थितियों को समझना

GitHub इन स्थितियों को merge के लिए स्वीकार्य मानता है:

- ✅ **Success**: जाँच पास हो गई
- ⚠️ **Skipped**: जाँच सशर्त रूप से छोड़ी गई
- ➖ **Neutral**: जाँच पूरी हुई लेकिन neutral परिणाम के साथ

⚠️ **महत्वपूर्ण:** "Skipped" को पासिंग माना जाता है! इसीलिए हमें आवश्यक जाँचों को स्पष्ट रूप से सूचीबद्ध करना होगा।

## शाखा सुरक्षा के बिना क्या होता है?

इन नियमों के बिना, निम्नलिखित हो सकता है:

1. **मूक विफलताएं**: PRs को छोड़ी गई जाँचों के साथ merge किया जा सकता है, जिससे समस्याएं आती हैं
2. **Main शाखा की विफलताएं**: PR जाँचें पास करने वाला कोड main पर fail हो सकता है
3. **गुणवत्ता में गिरावट**: फ़ॉर्मेटिंग, linting, या परीक्षण समस्याएं छूट जाती हैं
4. **Release अवरोध**: Main शाखा CI की विफलता releases रोक सकती है

**वास्तविक उदाहरण:** PR #955 `lint` जाँच छोड़ी गई स्थिति में merge हुआ क्योंकि इसने केवल `.md` फ़ाइलें बदली थीं। Workflow non-code changes के लिए सशर्त रूप से `lint` छोड़ देता है। Merge के बाद, main शाखा CI fail हो गई क्योंकि उन फ़ाइलों में फ़ॉर्मेटिंग समस्याएं थीं।

## Workflow की सशर्त तर्क

CI workflow CI समय अनुकूलित करने के लिए परिवर्तन पहचान का उपयोग करता है:

```yaml
detect-changes:
  outputs:
    mjs-changed: # true if .mjs files changed
    package-changed: # true if package.json changed
    docs-changed: # true if .md files changed
    workflow-changed: # true if workflow files changed
    docker-changed: # true if Docker files changed
    any-code-changed: # true if any code files changed
```

Jobs इन outputs का उपयोग सशर्त रूप से चलाने के लिए करती हैं:

```yaml
lint:
  if: |
    always() &&
    (github.event_name == 'push' || needs.changeset-check.result == 'success') &&
    (needs.detect-changes.outputs.mjs-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true')
```

**समस्या:** PRs पर, `lint` केवल तभी चलता है जब `.mjs` या workflow फ़ाइलें बदलती हैं। लेकिन main शाखा pushes पर, यह बिना किसी शर्त के चलता है। इस असंगतता ने case study #958 में दर्ज समस्या उत्पन्न की।

**शाखा सुरक्षा समाधान:** `lint` को "success" स्थिति में रखकर (न कि "skipped"), हम सुनिश्चित करते हैं कि यह हमेशा आवश्यकता होने पर चले।

## समस्या निवारण

### जाँच "Expected" के रूप में दिखती है लेकिन कभी नहीं चलती

**कारण:** शाखा सुरक्षा में जाँच का नाम workflow में job के नाम से मेल नहीं खाता।

**समाधान:**

1. किसी हाल के PR पर जाएं
2. "Show all checks" क्लिक करें
3. GitHub द्वारा दिखाए गए सटीक जाँच नाम की प्रतिलिपि बनाएं
4. शाखा सुरक्षा सेटिंग्स में वही सटीक नाम उपयोग करें

### जाँच वैध परिवर्तनों पर बार-बार fail होती है

**कारण:** जाँच बहुत सख्त हो सकती है या उसमें कोई bug हो सकता है।

**समाधान:**

1. जाँच के उद्देश्य की समीक्षा करें
2. जाँच की आवश्यकताओं को पूरा करने के लिए कोड ठीक करें, OR
3. यदि जाँच गलत तरीके से fail हो रही है तो उसकी logic अपडेट करें

### जाँच "Pending" में अटकने के कारण Merge नहीं हो सकता

**कारण:** GitHub Actions runner समस्या या workflow syntax त्रुटि।

**समाधान:**

1. Actions tab में workflow runs जाँचें
2. workflow YAML में त्रुटियां देखें
3. असफल जाँचें पुनः चलाएं
4. यदि लगातार हो, तो उस विशेष जाँच को अस्थायी रूप से अक्षम करना पड़ सकता है

## रखरखाव

### नई आवश्यक जाँचें जोड़ना

जब एक नई CI जाँच जोड़ी जाए जो हमेशा पास होनी चाहिए:

1. जाँच को workflow में जोड़ें
2. PR पर परीक्षण करें
3. एक बार काम करने की पुष्टि होने पर, इसे शाखा सुरक्षा आवश्यक जाँचों में जोड़ें
4. यह दस्तावेज़ अपडेट करें

### आवश्यक जाँचें हटाना

आवश्यक जाँच केवल तभी हटाएं जब:

1. जाँच अप्रचलित हो या किसी अन्य जाँच द्वारा प्रतिस्थापित हो
2. जाँच में लगातार गलत विफलताएं हों
3. टीम की सहमति हो कि यह महत्वपूर्ण नहीं है

इस फ़ाइल में कारण दर्ज करें।

## संदर्भ

- [GitHub Docs: संरक्षित शाखाओं के बारे में](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Docs: शाखा सुरक्षा नियम प्रबंधित करना](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
- [GitHub Docs: आवश्यक स्थिति जाँचों का समस्या निवारण](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
- [Case Study: Issue #958 - अनफ़ॉर्मेटेड फ़ाइलें Main में Merge हुईं](./case-studies/issue-958/ANALYSIS.md)

## प्रश्न?

यदि आपके शाखा सुरक्षा के बारे में प्रश्न हैं या किसी विशेष परिदृश्य में सहायता चाहिए, तो कृपया:

1. `docs/case-studies/` में case studies देखें
2. Workflow फ़ाइल की समीक्षा करें: `.github/workflows/release.yml`
3. `question` label के साथ एक issue खोलें

---

**अंतिम अपडेट:** 2025-12-21
**रखरखाव:** रिपॉजिटरी अनुरक्षक
