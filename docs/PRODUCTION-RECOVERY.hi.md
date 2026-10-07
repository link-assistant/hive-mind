# उत्पादन कार्यों की पुनर्प्राप्ति

Telegram बॉट, होस्ट पर स्थापित `solve` और Docker कार्य इमेज को समीक्षा किए गए रिलीज़ पर रखें। होस्ट का पैकेज अपडेट करने से चल रहा बॉट या स्थानीय कैश में मौजूद कार्य इमेज नहीं बदलती।

## अपडेट और सत्यापन

अक्टूबर 2026 की घटना में होस्ट 2.33.11 चला रहा था, जबकि मॉडल की reasoning सेटिंग का सुधार 2.33.13 में जारी हो चुका था। उस सुधार और इस PR के पुनर्प्राप्ति बदलावों वाले समीक्षा किए गए रिलीज़ पर अपडेट करें।

1. `solve --version`, `hive-telegram-bot --version`, कार्य इमेज और उसका digest रिकॉर्ड करें। प्रकाशित पैकेज संस्करण देखने के लिए `npm view @link-assistant/hive-mind version` चलाएँ।
2. npm स्थापना के लिए `npm install -g @link-assistant/hive-mind@<version>` चलाएँ। मौजूदा सेवा प्रबंधक से बॉट पुनः शुरू करें। जाँचें कि सेवा अपडेट किए गए executable का उपयोग करती है, PATH की किसी दूसरी स्थापना का नहीं।
3. चुना हुआ `konard/hive-mind` या `konard/hive-mind-dind` इमेज टैग डाउनलोड करें। निश्चित इमेज संदर्भ को स्पष्ट रूप से अपडेट करें। Coolify में निर्धारित इमेज डाउनलोड या पुनः बनाएँ और ऐप फिर तैनात करें। मौजूदा credentials mounts और कार्य सेटिंग बनाए रखें।
4. होस्ट और अगले अलग-थलग कार्य के startup संदेश में अपेक्षित Hive Mind संस्करण की पुष्टि करें। होस्ट संस्करण के साथ कार्य इमेज का digest भी रिकॉर्ड करें।
5. उत्पादन के tool, model और reasoning सेटिंग के साथ एक छोटा कार्य चलाएँ। Codex की reasoning क्षमता CLI catalogue से लॉन्च से पहले तय होती है; असंगत सेटिंग कार्य कंटेनर बनाने से पहले विफल होती है।

## प्रमाणीकरण

Docker कार्य लॉन्च करने से पहले होस्ट Claude/Codex subscription access जाँचता है। यह जाँच सहायक कंटेनर, इमेज डाउनलोड और कार्य कंटेनर निर्माण से पहले होती है। प्रमाणीकरण अस्वीकृत होने पर नया CLI process credentials refresh करने की एक कोशिश करता है, फिर usage जाँच दोहराई जाती है। हर जाँच अधिकतम 15 सेकंड और refresh process अधिकतम 20 सेकंड चलता है। Refresh एक छोटा मॉडल अनुरोध कर सकता है। एक tool और credentials path की समकालीन जाँचें एक साझा probe इस्तेमाल करती हैं।

Access बहाल न होने पर launch error और Telegram reply होस्ट पर दोबारा login करने का निर्देश देते हैं। उस tool के लंबित कार्य credentials फ़ाइल बदलने तक रुकते हैं। Task mounts देने वाले होस्ट पर `claude /login` या `codex login --device-auth` चलाएँ। फ़ाइल बदलने पर अगला कार्य फिर जाँच सकता है। दूसरे tools की queues अपनी जाँच जारी रखती हैं। चलती Claude session का access खोने पर भी नया CLI process केवल एक बार retry करता है। सफल refresh terminal queue-stop marker नहीं लिखता।

Usage API की विफलता और HTTP 429 से credentials अमान्य साबित नहीं होते। API-key, router और Formal AI कार्य subscription probe छोड़ते हैं; API-key की वैधता सामान्य provider execution में जाँची जाती है। Pause बॉट process में रहता है और restart के बाद preflight उसे फिर स्थापित करता है। मौजूदा `/hive` workers terminal access marker पर रुकते हैं; login के बाद `/hive` फिर शुरू करें।

साझा credentials के inode, atomic replacement और refresh lock की समस्या अलग से [#2296](https://github.com/link-assistant/hive-mind/issues/2296) में दर्ज है। यह preflight और retry credentials mount की प्रक्रिया नहीं बदलते।

## Restart budget समाप्त होना और मॉडल का इनकार

Auto-restart budget समाप्त होने पर पूरा run विफल होता है, PR draft रहता है और बाकी blocker तथा असफल CI checks के नाम वाली एक summary पोस्ट होती है। Comment PR commit को रिकॉर्ड करता है। Automatic `/hive --auto-continue` requeue उस commit को छह घंटे के लिए टालता है। बॉट पर `HIVE_MIND_AUTO_RESTART_COOLDOWN_HOURS` से अवधि बदलें; `0` इसे बंद करता है। नया PR commit या नए/संपादित issue, PR, inline या review feedback cooldown हटाते हैं। Session और log के automatic comments ऐसा नहीं करते। टाले गए issues बाद की queue iterations में फिर जाँचे जा सकते हैं। Manual `solve` उपलब्ध रहता है।

Codex का cybersecurity refusal terminal failure है। Issue/PR report मॉडल के इनकार को स्पष्ट करती है और `--tool claude` या अनुरोध को दोबारा लिखने का सुझाव देती है। Refusal transient-error retry loop में नहीं जाता।

## काम का संरक्षण और रुके हुए कंटेनर

Critical-error recovery अलग Git index से उपयुक्त uncommitted work का snapshot `recovery/<task-branch>` में बनाकर push करती है। PR branch, working tree और सामान्य index अगली session के लिए उपलब्ध रहते हैं। अधिकतम 5 MiB की untracked binary files सुरक्षित रहती हैं, जिनमें `docs/`, `tests/`, `fixtures/` और `experiments/` के screenshots और fixtures शामिल हैं। केवल extension या NUL byte से build output तय नहीं होता। ज्ञात build-output directories बाहर रखी जाती हैं। बहुत बड़ी या अपठनीय फ़ाइलों के लिए स्पष्ट skip reason लिखा जाता है और complete-preservation receipt नहीं बनती।

`HIVE_MIND_KEEP_TASK_CONTAINER=on-failure` पर completion monitor authentication, refusal या restart-budget failure वाला कंटेनर तभी हटाता है जब system recovery receipt uploaded logs और पूरे काम के remote preservation की पुष्टि करती है। Push किया गया recovery commit अपने parent का इतिहास सुरक्षित रखता है। Recovery commit के बिना clean tree का HEAD remote task branch से मेल खाना चाहिए। Failed uploads, failed pushes, अज्ञात preservation state, बड़ी binaries और unpushed commits कंटेनर को बनाए रखते हैं। अधूरा remote preservation workspace auto-cleanup भी बंद करता है ताकि रखा हुआ कंटेनर काम को सुरक्षित रखे। `always` कंटेनर बनाए रखता है। Completion removal बिना force वाला `docker rm` उपयोग करता है, जो फिर चलने लगे कंटेनर को हटाने से इनकार करता है। मौजूदा `none` policy उपलब्ध रहती है।

सुरक्षित evidence के आधार पर cleanup की अनुमति देने के लिए `--attach-logs` चालू करें। स्वतंत्र start-command lifecycle retention, TTL scanning और resume-image cleanup अलग काम हैं: [#2629](https://github.com/link-assistant/hive-mind/issues/2629) और [#2630](https://github.com/link-assistant/hive-mind/issues/2630)।

## Exit 137

केवल exit 137 से OOM kill साबित नहीं होता। मौजूदा cgroup `memory.events`/`oom_kill` diagnostics और completion report में Docker state देखें। RAM या swap बढ़ाने से पहले container memory limit और host headroom की समीक्षा करें। यह बदलाव production resource limits या मौजूदा OOM recovery path नहीं बदलता। अधूरी recovery वाला कंटेनर बनाए रखें और हटाने से पहले बताई गई विफलता जाँचें।
