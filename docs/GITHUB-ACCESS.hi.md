# Hive Mind को रिपॉज़िटरी तक पहुँच देना (languages: [en](GITHUB-ACCESS.md) • [zh](GITHUB-ACCESS.zh.md) • hi • [ru](GITHUB-ACCESS.ru.md))

Hive Mind एक सामान्य GitHub खाते से काम करता है। किसी निजी रिपॉज़िटरी पर काम करने के लिए, या ऐसी रिपॉज़िटरी में ब्रांच पुश करने और pull request खोलने के लिए जो उसकी अपनी नहीं है, उस खाते को **लिखने की अनुमति (write access)** चाहिए। अनुमति न होने पर Hive Mind "रिपॉज़िटरी '…' तक पहुँच नहीं है" (जिन निजी रिपॉज़िटरी को खाता नहीं देख सकता, उनके लिए GitHub 404 लौटाता है) या "पुश नहीं कर सकता" संदेश देता है। दोनों संदेशों में आमंत्रित किए जाने वाले खाते का नाम और नीचे दिए गए चरणों का लिंक होता है।

उदाहरणों में खाता `konard` है। इसकी जगह संदेश में दिया गया खाता लिखें: बॉट उसे जवाब में बताता है, और होस्ट पर `gh api user --jq .login` उसे दिखाता है।

## व्यक्तिगत रिपॉज़िटरी

![konard को व्यक्तिगत रिपॉज़िटरी में सहयोगी के रूप में आमंत्रित करना](./assets/github-access/personal-konard-hi.svg)

GIF के रूप में भी: [personal-konard-hi.gif](./assets/github-access/personal-konard-hi.gif)

1. `https://github.com/OWNER/REPO/settings/access` खोलें (**Settings → Collaborators**)।
2. **Add people** पर क्लिक करें, खाता खोजें और **Add … to REPO** पर क्लिक करें। व्यक्तिगत रिपॉज़िटरी के सहयोगी हमेशा पुश कर सकते हैं, इसलिए कोई भूमिका चुनने की ज़रूरत नहीं है।
3. कमांड फिर से चलाएँ। Hive Mind लंबित आमंत्रण अपने आप स्वीकार कर लेता है (`--auto-accept-invite` डिफ़ॉल्ट रूप से चालू है)। अन्यथा उस खाते से साइन इन करके `https://github.com/OWNER/REPO/invitations` पर आमंत्रण स्वीकार करें, या बॉट को `/accept_invites` भेजें।

GitHub Docs: [व्यक्तिगत रिपॉज़िटरी में सहयोगी को आमंत्रित करना](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository#inviting-a-collaborator-to-a-personal-repository) · [सहयोगी की पहुँच](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository#collaborator-access-for-a-repository-owned-by-a-personal-account)

## संगठन की रिपॉज़िटरी

![konard को Write भूमिका के साथ संगठन की रिपॉज़िटरी में आमंत्रित करना](./assets/github-access/organization-konard-hi.svg)

GIF के रूप में भी (अंग्रेज़ी कैप्शन): [organization-konard-en.gif](./assets/github-access/organization-konard-en.gif)

1. `https://github.com/OWNER/REPO/settings/access` खोलें (**Settings → Collaborators and teams**)।
2. **Add people** पर क्लिक करें, खाता खोजें, **Write** भूमिका चुनें और **Add … to REPO** पर क्लिक करें।
3. ऊपर बताए अनुसार कमांड फिर से चलाएँ।

यदि खाते के पास पहले से **Read** पहुँच है, तो Hive Mind रिपॉज़िटरी देख सकता है पर पुश नहीं कर सकता। **Manage access** में खाता ढूँढें और उसकी भूमिका **Write** करें।

GitHub Docs: [टीम या व्यक्ति को आमंत्रित करना](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-teams-and-people-with-access-to-your-repository#inviting-a-team-or-person) · [अनुमतियाँ बदलना](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-teams-and-people-with-access-to-your-repository#changing-permissions-for-a-team-or-person) · [हर भूमिका की अनुमतियाँ](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization#permissions-for-each-role)

GitHub Docs हिंदी में प्रकाशित नहीं होता, इसलिए लिंक अंग्रेज़ी पेज खोलते हैं।

## आपके अपने खाते के लिए एनिमेशन

ऊपर के एनिमेशन `konard` के लिए बनाए गए हैं। Hive Mind होस्ट उसी खाते के लिए, जिससे वह काम करता है, ऐसा ही एनिमेशन बनाता है — खाते, स्वामी के प्रकार और भाषा के हर संयोजन के लिए एक बार — और बाद में वही फ़ाइल दोबारा इस्तेमाल करता है। Telegram बॉट इसे "पहुँच नहीं है" वाले जवाब के साथ भेजता है। फ़ाइलें `~/.hive-mind/guides/github-access/` में रखी जाती हैं, या `HIVE_MIND_GUIDES_DIR` सेट होने पर `$HIVE_MIND_GUIDES_DIR/github-access/` में। बनाने के लिए [browser-commander](https://github.com/link-foundation/browser-commander) और Hive Mind इमेज के साथ आने वाला Playwright Chromium इस्तेमाल होता है।

हाथ से बनाने के लिए:

```bash
node src/github-access-animation.lib.mjs --login my-bot --locale hi                        # guides फ़ोल्डर में सहेजा जाता है
node src/github-access-animation.lib.mjs --login my-bot --locale hi --owner-type Organization --output org-hi.gif
node src/github-access-animation.lib.mjs --login my-bot --locale hi --output personal-hi.svg   # GIF के बजाय एनिमेटेड SVG
```

एनिमेशन GitHub के डार्क सेटिंग पेज की प्रतिकृति है (वही लेआउट, Primer रंग और Octicons आइकन), जो HTML से बनाई गई है, स्क्रीनशॉट नहीं, इसलिए इसमें कभी किसी की असली रिपॉज़िटरी नहीं दिखती। SVG और GIF एक ही दृश्य से बनते हैं: SVG उसे CSS से चलाता है, और GIF वही दृश्य 10 फ़्रेम प्रति सेकंड पर कैप्चर किया गया है। यदि होस्ट पर भाषा की लिपि के फ़ॉन्ट नहीं हैं, तो कैप्शन अंग्रेज़ी में दिखते हैं।

## असली GitHub पेज पर रिकॉर्डिंग

`scripts/record-github-access-guide.mjs` वही कर्सर, हाइलाइट और कैप्शन असली `github.com` सेटिंग पेज के ऊपर चलाता है और नतीजा GIF के रूप में सहेजता है। इसके लिए रिपॉज़िटरी के एडमिन के रूप में साइन-इन किया हुआ ब्राउज़र सत्र चाहिए: Chromium प्रोफ़ाइल फ़ोल्डर (`--user-data-dir`) या Playwright storage state (`--storage-state`)। `--headed` के साथ आप विंडो में साइन इन कर सकते हैं या पासवर्ड की पुष्टि कर सकते हैं; **Add people** स्क्रीन पर दिखते ही रिकॉर्डिंग शुरू होती है।

```bash
node scripts/record-github-access-guide.mjs --repo OWNER/REPO --login konard --user-data-dir ~/.config/hm-recorder --headed --output personal-konard-en.gif
node scripts/record-github-access-guide.mjs --repo ORG/REPO --login konard --owner-type Organization --locale hi --user-data-dir ~/.config/hm-recorder
node scripts/record-github-access-guide.mjs --mock --login konard --output mock.gif        # वही नियंत्रणों वाला स्थानीय पेज, GitHub के बिना
```

स्क्रिप्ट **Add people** पर क्लिक करती है, खाता टाइप करती है, उसे चुनती है और संगठनों के लिए **Write** भूमिका चुनती है। `--send-invite` के बिना वह **Add … to REPO** पर रुक जाती है और क्लिक नहीं करती, ताकि रिकॉर्डिंग गलती से किसी को आमंत्रित न करे। `--send-invite` के लिए परीक्षण रिपॉज़िटरी और परीक्षण खाता इस्तेमाल करें। अगर GitHub कोई लेबल बदल दे, तो स्क्रिप्ट रुक जाती है और चरण तथा आज़माए गए सेलेक्टर बताती है (`scripts/record-github-access-guide.lib.mjs`, `getRecorderSteps`)।

## GitHub की अन्य सेटिंग्स जिनके बारे में Hive Mind पूछ सकता है

जब समाधान कोई GitHub सेटिंग हो, तो अन्य संदेश भी GitHub Docs से लिंक करते हैं:

- [मेंटेनर को बदलाव की अनुमति देना](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork#enabling-repository-maintainer-permissions-on-existing-pull-requests) — फ़ोर्क से आए pull request के लिए
- [फ़ोर्किंग नीति](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-forking-policy-for-your-repository) — जब फ़ोर्क नहीं बन पाता
- [टोकन स्कोप](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes) — जब `gh` के पास कोई स्कोप नहीं होता (`gh auth refresh -s SCOPE`)
- [रेट लिमिट](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — जब GitHub अनुरोधों को सीमित करता है
- [संरक्षित ब्रांच](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) और [रूलसेट](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) — जब पुश या मर्ज अस्वीकार हो जाता है

जहाँ GitHub Docs पाठक की भाषा में प्रकाशित है (en, es, ja, pt, zh, ru, fr, ko, de), लिंक उसी भाषा में खुलते हैं, नहीं तो अंग्रेज़ी में।
