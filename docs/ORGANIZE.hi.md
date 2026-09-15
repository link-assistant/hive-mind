# खुले issues व्यवस्थित करना

Telegram `/organize` command एक GitHub repository के सभी खुले issues को
classify करता है: मौजूदा organization Issue Type assign करता है और repository
के मौजूदा labels समायोजित करता है। यह metadata maintenance है, issue-solving
workflow नहीं।

## उपयोग और defaults

```text
/organize https://github.com/owner/repository
/organize https://github.com/owner/repository --dry-run
/organize https://github.com/owner/repository --tool codex --model gpt-5.6-sol --think high
Examples और migration guides को documentation work मानें।
```

Repository URL वाले message का `/organize` से reply भी किया जा सकता है। केवल
एक repository स्वीकार होती है; scope सभी और केवल खुले issues है, pull requests
नहीं। Validated changes डिफ़ॉल्ट रूप से लागू होते हैं; `--dry-run` वही पूरा plan
और diff बिना write किए दिखाता है। `TELEGRAM_ORGANIZE=false` command बंद करता है।

यह command अन्य mutating commands वाली authorized group/topic policy इस्तेमाल
करता है। Bot के `gh` account को read और triage/write/maintain/admin permission
चाहिए। Issue text, comments, linked PR, README और operator notes untrusted data
हैं और fixed system prompt से अलग रहते हैं। Model को GitHub mutation credential
या mutation tool नहीं मिलता; उसका plan application सख्ती से validate करता है।

हर write से पहले `updatedAt` फिर पढ़ा जाता है और नया human edit मिलने पर issue
skip होता है। Bounded batches, partial-result read-before-retry और final full
read-back type तथा exact expected labels को verify करते हैं। Replies credential-
scan होते हैं और छोटा audit Hive Mind state के `organize-audits/` में रहता है।

केवल Issue Type और पहले से मौजूद labels बदल सकते हैं; उपयोगी unrelated labels
बचे रहते हैं। Command types/labels बनाता नहीं, assignee/milestone/title/body नहीं
बदलता, comment/close/reopen नहीं करता, code/branch/pull request नहीं बनाता। Missing
taxonomy report होती है। Unchanged repository पर दूसरा run कोई write नहीं करता।
