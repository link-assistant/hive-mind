# Formal AI ड्राफ़्ट (languages: [en](FORMAL-AI-DRAFTS.md) • [zh](FORMAL-AI-DRAFTS.zh.md) • hi • [ru](FORMAL-AI-DRAFTS.ru.md))

इस रिपॉज़िटरी में खुलने वाले हर issue को कुछ ही मिनटों में Formal AI से एक प्रयास मिलता है — एक ऐसी ब्रांच पर जिस पर कोई निर्भर नहीं है। गलत प्रयास की कोई कीमत नहीं। सही प्रयास पहला कमिट बचा देता है। असफल प्रयास भी बर्बादी नहीं है: वह सार्वजनिक रूप से विफल होता है, अपने सत्र के साक्ष्य के साथ, और यही विफलता वह इनपुट है जिससे मेटा-एल्गोरिदम का अगला सुधार बनता है।

यह [issue #2233](https://github.com/link-assistant/hive-mind/issues/2233) का उत्तर है।

## क्या चलता है

`.github/workflows/formal-ai-draft.yml` `issues: opened` पर चलता है — किसी चुनी हुई लेबल पर नहीं, क्योंकि लक्ष्य प्रतिदिन जुटने वाले साक्ष्य की मात्रा है, न कि यह कि कोई व्यक्ति तय करे कि किस issue पर प्रयास होना चाहिए। यह प्रकाशित `konard/hive-mind:<version>` इमेज में एक ही कमांड चलाता है, जहाँ `<version>` चेकआउट किए गए वर्कफ़्लो के `package.json` का संस्करण है:

```bash
solve <issue-url> \
  --tool agent \
  --model formal-ai \
  --attach-logs \
  --development-log \
  --verbose \
  --attribution formal-ai \
  --no-auto-restart-until-mergeable \
  --no-auto-restart-on-uncommitted-changes \
  --log-dir /home/box/logs
```

यह Hive Mind का अपना ही रास्ता है, इसलिए ये ड्राफ़्ट इस बात का सतत और बिना बनावट वाला मापन हैं कि `solve --model formal-ai` उसी रिपॉज़िटरी के वास्तविक कार्यों पर बेहतर हो रहा है या नहीं, जिसकी `solve` अपनी है।

जो कमिट बनता है उस पर चारों Formal AI ट्रेलर और साक्ष्य बंडल होते हैं ([#2229](https://github.com/link-assistant/hive-mind/issues/2229), [#2230](https://github.com/link-assistant/hive-mind/pull/2230), v2.24.0):

```
Formal-AI-Session: ses_…
Formal-AI-Model: formal-ai
Formal-AI-Evidence: dev/log/self-authored/issue-<n>/evidence
Formal-AI-Pull-Request: https://github.com/link-assistant/hive-mind/pull/<n>
```

ब्रांच का हर कमिट `github-actions[bot]` के नाम से बनता है। यह पहचान किसी कॉन्फ़िग फ़ाइल से नहीं, बल्कि `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` से सेट होती है, इसलिए कंटेनर के भीतर यह तब भी टिकती है जब किसी और का `HOME` माउंट हो (`experiments/issue-2233/probe-git-identity.sh` इसे मापता है)।

चार फ़्लैग विरासत में नहीं मिले, चुने गए हैं:

| फ़्लैग                                     | क्यों                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--attribution formal-ai`                  | ट्रेलर और साक्ष्य बंडल ही इस पूरी कवायद का मक़सद हैं, इसलिए इन्हें `auto` पर छोड़ने के बजाय ज़बरदस्ती चालू रखा जाता है।                                                                                       |
| `--no-auto-restart-until-mergeable`        | डिफ़ॉल्ट रूप से चालू। चालू रहने पर एक ही रन pull request की जाँचों पर नज़र रखता है और उन्हें हरा करने तक मॉडल को दोबारा चलाता रहता है — 24 घंटे तक। नीचे दी गई विफलता-नीति कहती है कि यह काम _अगले_ रन का है। |
| `--no-auto-restart-on-uncommitted-changes` | डिफ़ॉल्ट रूप से चालू। चालू रहने पर मॉडल द्वारा छोड़ी गई हर अनकमिटेड फ़ाइल उसे दोबारा चलाती है — एक रन में पाँच अतिरिक्त सत्र तक। विफलता-नीति यहाँ भी लागू है: दोबारा प्रयास अगला रन है।                       |
| `--log-dir`                                | सत्र लॉग bind-mount के ज़रिए कंटेनर से बाहर आता है और वर्कफ़्लो आर्टिफ़ैक्ट के रूप में अपलोड होता है, इसलिए वह तब भी पढ़ा जा सकता है जब कोई pull request खुला ही न हो।                                        |

### इमेज, बाइनरी और Formal AI की अपनी स्थिति

- स्क्रिप्ट `konard/hive-mind:<version>` को स्पष्ट रूप से pull करती है और रजिस्ट्री टाइमआउट पर 15 सेकंड, 30 सेकंड, 1 मिनट और 2 मिनट बाद फिर कोशिश करती है, ताकि कंटेनर वही hive-mind चलाए जो उसके बगल की स्क्रिप्टें हैं। जो टैग अभी प्रकाशित नहीं हुआ (संस्करण `main` पर बढ़ा पर रिलीज़ पूरी नहीं हुई) वह चेतावनी के साथ `konard/hive-mind:latest` पर लौट आता है। `image` इनपुट या `FORMAL_AI_DRAFT_IMAGE` variable जैसा दिया गया वैसा ही इस्तेमाल होता है।
- सत्र जो Formal AI सर्वर शुरू करता है, उसे अपनी होम डायरेक्टरी में `FORMAL_AI_CACHE_DIR` मिलता है। Formal AI फिर भी क्लोन में `data/cache/derivations/` लिखता है, इसलिए यह डायरेक्टरी, `.formal-ai/` की तरह, अनकमिटेड बदलावों की जाँच से और `recovery/<branch>` ब्रांचों पर सहेजे गए काम से बाहर रखी जाती है: यह टूल की स्थिति है, उपयोगकर्ता का काम नहीं।
- कंटेनर `--rm` के साथ शुरू होता है, इसलिए विफलता की टिप्पणी कभी उसके भीतर के पथ की ओर इशारा नहीं करती। वह वर्कफ़्लो रन को लिंक करती है, जिसके आर्टिफ़ैक्ट में सत्र लॉग है।

### pull request पर जाँचें

Default token से खुला pull request कोई `pull_request` रन शुरू नहीं करता, और उसकी ब्रांच पर dispatch की गई जाँचें किसी pull request से जुड़ी नहीं होतीं। इसलिए `report-checks` job हर dispatch किए गए रन को ड्राफ़्ट के head commit पर commit status (`dispatched / release.yml`, …) के रूप में पोस्ट करता है और रन पूरा होने तक उसे अपडेट रखता है, ताकि ड्राफ़्ट अपनी जाँचें दिखाए।

`--auto-merge` और `--auto-close-pull-request-on-fail` कभी नहीं दिए जाते। दोनों डिफ़ॉल्ट रूप से बंद हैं; `tests/formal-ai-draft-2233.test.mjs` यह जाँचता है कि वे अनुपस्थित ही रहें, क्योंकि इनमें से कोई भी चालू करना विफलता-नीति को चुपचाप तोड़ देगा।

## विफलता-नीति

किसी ड्राफ़्ट को छूने से पहले यही हिस्सा पढ़ना चाहिए।

1. **विफल ड्राफ़्ट खुला और लाल ही रहता है।** उसे ठीक नहीं किया जाता। उसे पलटा नहीं जाता। वह किसी बाद के सफल रन की प्रतीक्षा करता है। लाल होना ही मापन है; उसे हाथ से हरा कर देना मापन को नष्ट कर देता है।
2. **ड्राफ़्ट को कभी हाथ से सुधार कर मर्ज नहीं किया जाता।** सत्र के बाद वर्कफ़्लो pull request को वापस ड्राफ़्ट में डाल देता है (solve सत्र के अंत में उसे ready-for-review कर देता है, देखें [#2123](https://github.com/link-assistant/hive-mind/issues/2123)/[#2182](https://github.com/link-assistant/hive-mind/issues/2182)), और GitHub ड्राफ़्ट को मर्ज करने से मना कर देता है। यदि किसी ड्राफ़्ट में संयोगवश सही बदलाव हो, तो सही प्रतिक्रिया यह है कि इसे issue में दर्ज किया जाए और एक सामान्य रन को सामान्य pull request बनाने दिया जाए — न कि ड्राफ़्ट ब्रांच को अपना लिया जाए।
3. **खराब ड्राफ़्ट बंद कर दिया जाता है, और दोष मेटा-एल्गोरिदम पर दर्ज होता है।** ब्रांच पर पैच नहीं लगाया जाता। नए issue में जिस प्रश्न का उत्तर देना है वह है "एल्गोरिदम ने यह क्यों बनाया", न कि "मैं इस diff को सही कैसे करूँ"। नए issue से बंद किए गए ड्राफ़्ट और उसके सत्र लॉग को लिंक करें।
4. **ड्राफ़्ट ब्रांच पर कभी कोई मानव कमिट नहीं आता।** मानव कमिट उस ब्रांच को साक्ष्य के रूप में बेकार कर देता है: फिर यह नहीं कहा जा सकता कि मॉडल ने क्या बनाया। यदि किसी ब्रांच को मानव कमिट चाहिए, तो उसे एक अलग ब्रांच होना चाहिए।

ड्राफ़्ट को `formal-ai-draft` लेबल (न होने पर workflow इसे पहली बार में बना देता है) और उसकी ब्रांच के नाम `issue-<number>-<suffix>` से पहचाना जा सकता है।

## सेटअप

किसी credential setup की आवश्यकता नहीं है। सभी write workflows एक resolver का उपयोग करते हैं: GitHub App (`AUTOMATION_APP_ID` variable और `AUTOMATION_APP_PRIVATE_KEY` secret) → एक `AUTOMATION_TOKEN` secret → built-in `github.token`। पहला उपलब्ध layer चुना जाता है। व्यक्तिगत token को contents, issues, pull requests और Actions write permissions चाहिए। `FORMAL_AI_DRAFT_IMAGE` वैकल्पिक variable है (डिफ़ॉल्ट `konard/hive-mind:<version>`)।

Default token से बने pull request की जाँच approval की प्रतीक्षा कर सकती है। Draft workflow तुरंत `dispatch-checks` से draft branch पर `mode=checks` के साथ `release.yml`, `security.yml`, `links.yml` और `workflows.yml` चलाता है। Release के लिए स्पष्ट release mode और `main` branch चाहिए। वैकल्पिक credentials न होने पर प्रयास नहीं छोड़ा जाता; summary में layer दिखता है। दैनिक health check पिछले सात दिनों के वास्तविक प्रयास गिनता है। यह तब भी विफल होता है जब पिछले पाँच ड्राफ़्ट रन एक ही `decision_code` या एक ही पहली त्रुटि पर समाप्त हुए हों; यह उस त्रुटि का नाम लेता है और उसे ट्रैक करने वाले खुले issue को लिंक करता है (या एक खोलने को कहता है)। हर ड्राफ़्ट job दोनों को annotations के रूप में दर्ज करता है, इसलिए रन का सारांश बताता है कि ड्राफ़्ट लाल क्यों है।

Shared actions अभी प्रकाशित नहीं हैं: [link-foundation/.github#1](https://github.com/link-foundation/.github/issues/1)। फिलहाल `.github/actions/` में compatible local actions हैं।

## किसी दूसरे रिपॉज़िटरी से ड्राफ़्ट चलाना

वर्कफ़्लो पुन: प्रयोज्य है (`workflow_call`), इसलिए `link-assistant/formal-ai` किसी बिल्ड को रिलीज़ से पहले वास्तविक issue पर आज़मा सकता है:

```yaml
jobs:
  draft:
    uses: link-assistant/hive-mind/.github/workflows/formal-ai-draft.yml@main
    with:
      issue_number: '42'
      formal_ai_binary_artifact: formal-ai-linux-x64
    secrets: inherit
```

| इनपुट                       | अर्थ                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_number`              | कॉल करने वाले रिपॉज़िटरी का issue। यदि कॉल करने वाला स्वयं `issues: opened` पर चलता है तो इसे छोड़ दें।                                                       |
| `image`                     | `konard/hive-mind:<version>` के बजाय चलाई जाने वाली hive-mind इमेज।                                                                                           |
| `formal_ai_binary_artifact` | कॉल करने वाले रन के उस आर्टिफ़ैक्ट का नाम जिसमें `formal-ai` नाम की फ़ाइल है। इसे इमेज के `/usr/local/bin/formal-ai` पर केवल-पढ़ने के लिए माउंट किया जाता है। |
| `hive_mind_repository`      | वह रिपॉज़िटरी जिसकी ड्राफ़्ट स्क्रिप्टें चेकआउट होती हैं (डिफ़ॉल्ट `link-assistant/hive-mind`)।                                                               |
| `hive_mind_ref`             | उस रिपॉज़िटरी का चेकआउट किया जाने वाला ref (डिफ़ॉल्ट: उसकी डिफ़ॉल्ट ब्रांच)।                                                                                  |

बाइनरी को इमेज के Ubuntu आधार (glibc) पर चलना चाहिए। कॉल किए जाने पर वर्कफ़्लो इस रिपॉज़िटरी की जाँचें dispatch नहीं करता और उसका health job नहीं चलाता; यहाँ `issues: opened` पहले की तरह काम करता है।

## बाहर निकलना, और दोबारा चलाना

- प्रयास रोकने के लिए issue टेम्पलेट में, या issue खोलने से पहले उस पर, `no-formal-ai-draft` लेबल लगा दें।
- बॉट द्वारा खोले गए issue छोड़ दिए जाते हैं: दो ऑटोमेशन एक-दूसरे को खिलाएँ तो शोर बनता है, साक्ष्य नहीं।
- किसी issue पर दोबारा प्रयास करने के लिए वर्कफ़्लो को issue संख्या के साथ मैन्युअली चलाएँ (`Actions → Formal AI Draft → Run workflow`)। मैन्युअल रिप्ले को एक नया `opened` इवेंट माना जाता है।

## विफल ड्राफ़्ट कैसे पढ़ें

1. सत्र लॉग `--attach-logs` द्वारा pull request से जुड़ा होता है।
2. यदि कोई pull request नहीं खुला, तो वही लॉग वर्कफ़्लो रन पर `formal-ai-draft-session-<issue>` आर्टिफ़ैक्ट के रूप में मिलता है, जो 30 दिन रखा जाता है। रन के annotations सत्र द्वारा दर्ज पहली त्रुटि का नाम बताते हैं।
3. ब्रांच पर `dev/log/self-authored/issue-<n>/evidence` में `agent-stream.jsonl` और `session-id.txt` होते हैं — यह मॉडल का अपना रिकॉर्ड है कि उसने क्या किया, Hive Mind का उसका सारांश नहीं।

## जब formal-ai अपना composite action प्रकाशित करे

[Issue #2233](https://github.com/link-assistant/hive-mind/issues/2233) उस पुन: प्रयोज्य action को स्थापित करने के लिए कहता है जिसे `link-assistant/formal-ai` अपने `self-authored-pull-request.yml` से अलग करके पैकेज कर रहा है। वह action अभी प्रकाशित नहीं है — इस लेखन के समय के साक्ष्य के लिए [`docs/case-studies/issue-2233/`](case-studies/issue-2233/README.md) देखें। `uses:` कोई expression स्वीकार नहीं करता, इसलिए ऐसा वर्कफ़्लो लिखना संभव नहीं जो उस action के प्रकट होते ही उसे स्वयं अपना ले।

अदला-बदली एक ही चरण की है। `.github/workflows/formal-ai-draft.yml` के `Open the Formal AI draft` चरण को `uses: link-assistant/formal-ai@<tag>` चरण से बदलें और उसे वही इनपुट दें जो आज स्क्रिप्ट बनाती है। बाकी सब कुछ — ट्रिगर, छोड़ने के निर्णय, concurrency समूह, विफलता-नीति, आर्टिफ़ैक्ट — इस बात से स्वतंत्र है कि प्रयास कौन निष्पादित करता है। `scripts/formal-ai-draft.lib.mjs` और उसका टेस्ट बनाए रखें: प्रयास _करना है या नहीं_, यह निर्णय Hive Mind का है, उस action का नहीं।
