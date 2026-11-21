# स्वचालित मर्ज से पहले issue के पूरा होने की जाँच

Issue से जुड़ा solve तभी पूरा माना जाता है जब issue और सभी आवश्यक sub-issues की हर आवश्यकता एक ही pull request में लागू और सत्यापित हो (issue #2406)। सफल CI, आंशिक implementation या workaround पूरा होना नहीं है।

## Prompts और goals

सभी छह tools (claude, codex, opencode, agent, gemini, qwen) के system, initial और continuation prompts में यह पूर्ण-डिलीवरी लक्ष्य है। `--minimal-restart-context` वाला छोटा claude prompt भी इसे शामिल करता है। Prompts tool से कहते हैं कि native goal API उपलब्ध हो तो उससे लक्ष्य सेट करे, और न हो तो स्थायी checklist रखे।

Codex हमेशा `-c features.goals=true` के साथ चलता है, सीधे भी और agent-commander के ज़रिए भी। `--auxiliary-model-calls-disabled` अब केवल `features.personality` बंद करता है: goals स्वयं कार्य को आगे ले जाते हैं, वे सहायक कॉल नहीं हैं।

## Requirements report प्रायोगिक है और डिफ़ॉल्ट रूप से बंद है

नीचे requirements report के बारे में लिखी हर बात केवल स्पष्ट रूप से चालू करने पर लागू होती है (issue #3469)। `solve` को `--requirements-report` दें, या बिना command line वाली प्रक्रियाओं (जैसे Telegram merge queue) के लिए `HIVE_MIND_REQUIREMENTS_REPORT=true` सेट करें। इसके बिना:

- कोई prompt report, snapshot command या merge guard का उल्लेख नहीं करता, इसलिए उन पर कोई token खर्च नहीं होता। ऊपर दिया complete-delivery goal और closing reference के नियम बने रहते हैं।
- Solve के बाद कोई completion restart नहीं चलता।
- Merge guard केवल हर आवश्यक issue के closing references (issue #2335) जाँचता है, और merge को अब भी `--match-head-commit` से पिन करता है।

यह सुविधा तब बंद की गई जब merge guard ने एक पूरा हो चुका pull request रोक दिया: hive-mind के अपने `.gitkeep` cleanup commit ने report लिखे जाने के बाद head बदल दिया, इसलिए report मौजूदा commit का वर्णन नहीं करता था ([case study](case-studies/issue-3469/README.md))।

## Requirements report बनाना

अंतिम push के बाद मौजूदा issue, सभी issue comments और pull request के सभी comments, inline comments तथा reviews से template बनाएँ:

```bash
node /path/to/hive-mind/src/issue-requirements-snapshot.mjs OWNER/REPO ISSUE_NUMBER PR_NUMBER
```

Tool prompts installed script का absolute path देते हैं। यह command केवल GitHub पढ़ता है और template छापता है; हर entry `pending` से शुरू होती है। Checklist extractor से छूटी गद्य आवश्यकताएँ जोड़ें। हर आवश्यकता के लिए समीक्षा योग्य evidence लिखें और पूरा होने पर ही status `done` करें। जो आवश्यकता पूरी नहीं हो सकती उसे blocker के evidence के साथ `blocked` चिह्नित करें। पूरी report को markers सहित pull request के विवरण में जोड़ें:

```text
<!-- hive-mind:requirements:start -->
...बनाई गई JSON report...
<!-- hive-mind:requirements:end -->
```

नए commit या नए issue/review feedback के बाद report फिर से बनाएँ। hive-mind placeholder विवरण बदलते समय मौजूदा report को बनाए रखता है।

## मर्ज की अनुमति कब मिलती है

`--auto-merge`, merge queue और solve के बाद की जाँचों द्वारा उपयोग होने वाला साझा merge function माँगता है:

- हर आवश्यक issue के लिए सकारात्मक closing references (मौजूदा link guard)।
- ठीक एक वैध report, जो ठीक आवश्यक issues को कवर करे।
- मौजूदा pull request head SHA, और मौजूदा issue तथा feedback से मेल खाते source digests।
- हर स्पष्ट acceptance criterion, `done` status और गैर-खाली evidence के साथ।

हर GitHub read सफल होना चाहिए; अपठनीय या गलत response merge को रोकता है। Merge command `--match-head-commit` भी देता है ताकि साथ-साथ हुआ push बिना जाँच के merge न हो। बिना linked issue वाले pull requests पहले की तरह merge होते हैं।

## Completion restarts

`--requirements-report` के साथ, solve के बाद hive-mind tool को तब तक फिर चलाता है जब तक report पास न हो जाए। डिफ़ॉल्ट रूप से तीन restarts होते हैं; `--ensure-all-sub-issues-addressed=N` सीमा तय करता है। Usage limits, बार-बार tool या verification विफलता, या केवल `blocked` आवश्यकताएँ बचने पर restarts पहले रुक जाते हैं। तब pull request बिना merge के रहता है, और blocked-merge comment हाथ से merge की सलाह देने के बजाय बचा हुआ काम बताता है।

## सीमाएँ

Report evidence की सूची है, यह मनमानी गद्य आवश्यकताओं के पूरा होने का प्रमाण नहीं है। Evidence की समीक्षा अब भी लोगों को करनी चाहिए। Repository administrator hive-mind के बाहर merge कर सकता है।
