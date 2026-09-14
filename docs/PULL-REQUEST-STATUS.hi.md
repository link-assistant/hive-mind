# Pull request की स्थिति (languages: [en](PULL-REQUEST-STATUS.md) • [zh](PULL-REQUEST-STATUS.zh.md) • hi • [ru](PULL-REQUEST-STATUS.ru.md))

Hive Mind द्वारा खोले गए pull request की तीन स्थितियाँ होती हैं, और केवल अंतिम स्थिति का अर्थ है "अब आप इसे merge कर सकते हैं"।

| स्थिति                          | इसका क्या अर्थ है                                                                    | आपको क्या करना चाहिए                       |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| **Draft**                       | Hive Mind अभी भी काम कर रहा है: कोई session चल रहा है, या CI/CD अभी हरा नहीं हुआ है। | प्रतीक्षा करें।                            |
| **Ready for review**            | Hive Mind ने mergeable स्थिति सत्यापित कर ली है — mergeable मोड में यही संकेत है।    | समीक्षा करें।                              |
| **`✅ Ready to merge`** टिप्पणी | सभी CI/CD जाँचें पास हैं और कोई merge conflict नहीं है।                              | Merge करें, या `--auto-merge` को करने दें। |

pull request के विवरण में **🚦 How to read this pull request status** सूचना होती है जो बताती है कि नीचे दिए गए मोड में से कौन सा सक्रिय है; work-session टिप्पणियाँ वही बात एक पंक्ति में दोहराती हैं। यदि आप केवल एक चीज़ पढ़ें, तो यही सूचना पढ़ें: यह उस संकेत का नाम बताती है जिसकी प्रतीक्षा करनी है।

> यह क्यों मायने रखता है: [`Time0utXC/digitalstructures.pro#4`](https://github.com/Time0utXC/digitalstructures.pro/pull/4) में एक pull request तब merge कर दिया गया जब AI अभी भी उस पर काम कर रहा था। अधूरा काम — और उस पर खर्च हुए AI संसाधन — नष्ट हो गए। देखें [issue #2246](https://github.com/link-assistant/hive-mind/issues/2246)।

## मोड

### `--auto-restart-until-mergeable` (डिफ़ॉल्ट)

Hive Mind तब तक काम करता रहता है जब तक pull request mergeable न हो जाए: **सभी** CI/CD जाँचें पास हों — उन जाँचों सहित जो issue से असंबंधित लगती हैं — और branch का अपने base से कोई conflict न हो। इस पूरे समय pull request draft बना रहता है। जब mergeable स्थिति सत्यापित हो जाती है, Hive Mind स्वयं उसे draft से बाहर निकालता है और `## ✅ Ready to merge` टिप्पणी पोस्ट करता है। वही टिप्पणी आपकी हरी झंडी है; merge आपको करना है।

### `--auto-merge`

वही सब, और उसके बाद Hive Mind आपके लिए pull request merge भी कर देता है। इसमें `--auto-restart-until-mergeable` निहित है।

### `--no-auto-restart-until-mergeable`

एक ही work session, उसके बाद CI/CD की कोई निगरानी नहीं। session चलने के दौरान pull request draft रहता है और समाप्त होने पर ready for review कर दिया जाता है — **उस समय CI/CD अभी चल रहा हो सकता है या विफल हो सकता है**, और कोई `✅ Ready to merge` टिप्पणी पोस्ट नहीं होती। यहाँ "ready for review" का ठीक यही अर्थ है: इसकी समीक्षा कीजिए।

## draft flag का स्वामी कौन है

Hive Mind, न कि AI worker।

- pull request `gh pr create --draft` से बनाया जाता है, और फिर स्थिति **वापस पढ़ी जाती है** — जो repository draft pull request की अनुमति नहीं देती वह इस flag को चुपचाप अनदेखा कर देती है, इसलिए यदि pull request ready for review बना हो तो उसे स्पष्ट रूप से draft में बदल दिया जाता है।
- हर work session शुरू होते ही pull request को draft में बदल देता है।
- mergeable मोड में ready-for-review में जाने को तब तक **रोक कर रखा जाता है** जब तक mergeable स्थिति सत्यापित न हो जाए। यदि AI worker या कोई व्यक्ति बीच में pull request को draft से बाहर निकालता है, तो Hive Mind उसे वापस draft कर देता है और `⏸️ PR stays draft` लॉग करता है।
- पूरा हुआ run कभी भी pull request को draft में नहीं छोड़ता। हर exit path पर — सामान्य समाप्ति, `CTRL+C`, या घातक त्रुटि — रोक हटा दी जाती है और pull request ready for review कर दिया जाता है।

Tool prompts यह सब AI worker को भी एक ही पंक्ति में बताते हैं: उसे pull request की स्थिति स्वयं नहीं बदलनी चाहिए, स्थिति Hive Mind सिस्टम द्वारा संभाली जाती है, और उसके काम का लक्ष्य एक _mergeable_ pull request है — हर विफल जाँच उसकी ज़िम्मेदारी है, भले ही वह उसे दिए गए issue से असंबंधित लगे।

## जब स्थिति अपेक्षा से अलग दिखे

| आप क्या देखते हैं                                     | इसका क्या अर्थ है                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Draft, और अंतिम टिप्पणी session समाप्त होने की है     | एक session समाप्त हुआ; mergeable मोड में Hive Mind अब CI/CD देख रहा है। टिप्पणी में यही लिखा है।                                         |
| Ready for review, पर `✅ Ready to merge` टिप्पणी नहीं | या तो run `--no-auto-restart-until-mergeable` मोड में है, या निगरानी रुक गई — रुकने वाली टिप्पणी कारण बताती है (timeout, billing limit)। |
| लॉग में `⏸️ PR stays draft`                           | रोक लगी होने के दौरान किसी ने ready-for-review माँगा; draft फिर से लागू कर दिया गया।                                                     |
| `✅ Ready to merge`, और उसके बाद नए commits           | सत्यापन के बाद किसी ने push किया। अगली निगरानी जाँच फिर से सत्यापन करेगी और pull request दोबारा काम में लौट सकता है।                     |

## संबंधित

- [CONFIGURATION.hi.md](./CONFIGURATION.hi.md#solve-options) — यहाँ बताए गए सभी flags
- [CI-CD-BEST-PRACTICES.hi.md](./CI-CD-BEST-PRACTICES.hi.md) — "सभी जाँचें पास हों" के लिए repository से क्या अपेक्षित है
