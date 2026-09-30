# स्वचालित मर्ज से पहले issue के पूरा होने की जाँच

Issue से संबंधित solve अब हर कार्य सत्र के बाद pull request का विवरण सुधारता है और `--finalize` या `--ensure-all-sub-issues-addressed` के बिना भी पूर्णता जाँचता है। मूल issue, उसके सभी स्तरों के मूल GitHub sub-issues और बनाई गई संयुक्त issue की आवश्यक संदर्भ सूची के लिए विवरण में सकारात्मक closing references होने चाहिए। उदाहरणों, टिप्पणियों, शीर्षकों या नकारात्मक वाक्यों में संदर्भ किसी लिंक की पुष्टि नहीं करते। दूसरे repository के issues के लिए उसका सटीक नाम आवश्यक है।

Repository mode संयुक्त issue के विवरण में सभी खुले issues शामिल करता है। GitHub एक parent के लिए अधिकतम 100 मूल child issues की अनुमति देता है; बाकी आवश्यक संदर्भ सूची में रहते हैं और उसी pull request के कार्यक्षेत्र का हिस्सा हैं।

सभी छह tools के prompts इसी pull request में पूरा implementation और verification माँगते हैं। Codex `features.goals=true` के साथ चलता है; prompts उपलब्ध native goal API से लक्ष्य सेट करने और API उपलब्ध न होने पर स्थायी योजना तथा checklist रखने को कहते हैं। Completion restart loop डिफ़ॉल्ट रूप से पाँच प्रयास करता है; `--ensure-all-sub-issues-addressed=N` भी इस सीमा को नियंत्रित करता है। प्रयास समाप्त होने, usage limit आने या GitHub data पढ़ने में विफलता पर pull request मर्ज नहीं होता।

## Requirements report बनाना

अंतिम push के बाद वर्तमान issue विवरण, सभी issue comments और pull request feedback के तीनों endpoints से template बनाएँ:

```bash
node /path/to/hive-mind/src/issue-requirements-snapshot.mjs OWNER/REPO ISSUE_NUMBER PR_NUMBER
```

Tool prompts installed script का absolute path देते हैं। यह command केवल GitHub पढ़ता है और template छापता है; हर entry शुरू में `pending` होती है। स्पष्ट checklist extractor से छूटे गद्य में लिखे requirements भी जोड़ें। हर requirement के लिए समीक्षा योग्य implementation और verification evidence लिखें और पूरा होने पर ही status `done` करें। अनसुलझे requirements को `blocked` रखें। पूरे report को दिए गए markers सहित pull request के विवरण में जोड़ें:

```text
<!-- hive-mind:requirements:start -->
...बनाया गया JSON report...
<!-- hive-mind:requirements:end -->
```

नए commit या issue/review feedback में बदलाव के बाद report दोबारा बनाएँ। विवरण बदलते समय report सुरक्षित रखें। Closing references report के code block के बाहर रखें; हर issue के लिए अलग सकारात्मक closing keyword लिखें।

## मर्ज की अनुमति कब मिलती है

साझा merge function merge queue सहित हर स्वचालित प्रवेश मार्ग पर जाँच करता है। इसके लिए चाहिए:

- सभी आवश्यक issues के सकारात्मक closing references।
- ठीक एक वैध requirements report, जिसमें ठीक वही आवश्यक issues हों।
- वर्तमान PR head SHA और वर्तमान source digests।
- सभी स्पष्ट acceptance criteria, `done` statuses और गैर-खाली evidence।
- Default branch को target करते समय GitHub से पुष्टि किए गए मूल closing links।

GitHub reads, pagination और response validation सफल होने चाहिए। Merge command `--match-head-commit` से साथ में होने वाले code push को अस्वीकार करता है। दूसरी branch में merge करने पर GitHub issues अपने आप बंद नहीं करता; hive-mind merge के बाद हर verified issue को बंद करता है और अलग-अलग विफलताओं की सूचना देता है। Issue context के बिना केवल PR maintenance मौजूदा merge workflow का उपयोग करता है।

Verbose mode verified issue count और commit SHA दर्ज करता है; verification failures बाधा का कारण बताते हैं। Completion-blocked comments हाथ से merge करने की सलाह देने के बजाय बचा हुआ कार्य और evidence माँगते हैं।

## Verification की सीमाएँ

Report आवश्यक, वर्तमान evidence inventory है; यह मनमाने गद्य के पूरा होने या agent के evidence की सच्चाई का प्रमाण नहीं है। मनुष्यों को evidence की समीक्षा करनी चाहिए। Repository administrator hive-mind के बाहर GitHub से merge कर सकता है; आखिरी read और merge के बीच source comments तथा PR description बदल सकते हैं। GitHub commit guard देता है, लेकिन इन सभी बाहरी records को एक साथ lock नहीं करता। बड़ी issue inventories GitHub body-size और API limits के अधीन हैं; publication या verification की विफलता पर merge रुका रहना चाहिए।

[Issue 2335 case study](case-studies/issue-2335/README.md) में reproduce की गई failure, implementation, tests और ये व्यावहारिक सीमाएँ दर्ज हैं।
