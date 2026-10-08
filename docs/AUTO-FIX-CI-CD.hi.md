# Merge के बाद CI/CD की स्वचालित मरम्मत

Pull request merge होने के बाद CI/CD समस्याएँ हल करते रहने के लिए `--auto-fix-ci-cd` को `--auto-merge` के साथ उपयोग करें:

```bash
solve https://github.com/owner/repo/issues/123 --auto-merge --auto-fix-ci-cd
```

यही विकल्प Telegram `/solve` और `hive` में भी काम करते हैं। यह सुविधा डिफ़ॉल्ट रूप से बंद है; `--auto-merge` के बिना यह विकल्प देने पर argument validation विफल होता है।

GitHub द्वारा merge की पुष्टि के बाद solver pull request की वास्तविक target branch की जाँच करता है। वह प्रत्येक सक्रिय workflow का नवीनतम branch run और वर्तमान branch commit पर runs देखता है, जिनमें tag से शुरू होने वाले publishers भी शामिल हैं। Failed, cancelled, timed-out और अज्ञात workflow परिणाम त्रुटियाँ हैं। चल रहे workflows और अनुपलब्ध runs के लिए प्रतीक्षा जारी रहती है।

प्रकाशन का उद्देश्य सक्रिय workflow फ़ाइलों, package manifests और संदर्भित स्थानीय scripts से पहचाना जाता है। Scripts केवल पढ़ी जाती हैं, चलाई नहीं जातीं। हर पहचाने गए output का प्रमाण आवश्यक है:

| Output         | आवश्यक प्रमाण                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub release | Merge के बाद प्रकाशित release, जिसका tag commit merge किए गए बदलाव को समाहित करता हो; drafts मान्य नहीं हैं।                         |
| npm            | सार्वजनिक npm registry में वर्तमान manifest version और merge के बाद का publication timestamp हो। Private packages बाहर रखे जाते हैं। |
| PyPI           | वर्तमान static project/Poetry version का distribution merge के बाद upload हुआ हो।                                                    |
| crates.io      | वर्तमान static crate version merge के बाद प्रकाशित हो। `publish = false` या `publish = []` वाले crates बाहर रखे जाते हैं।            |
| GitHub Pages   | Merge के बाद सफल `github-pages` environment deployment या branch-based Pages build, जिसके commit में बदलाव शामिल हो।                 |

मूल merge के बाद version-bump commits आ सकते हैं। Verifier वर्तमान target-branch commit से package metadata पढ़ता है और release/deployment commits की Git ancestry जाँचता है। हर repair के बाद वह उस repair के pull request का merge commit प्राप्त करता है; release bot द्वारा branch आगे बढ़ाना repair merge होने का पर्याप्त प्रमाण नहीं है। पुराना release या registry version नए merge को पास नहीं कर सकता।

किसी release या deployment के बिना CI पास होना भी त्रुटि है। Publishing step का skip होना पर्याप्त नहीं है। यदि registry, dynamic version या publishing configuration सत्यापित नहीं किया जा सके, तो solver अनुपलब्ध प्रमाण बताता है। सीधे registry verification में सार्वजनिक npm, PyPI और crates.io समर्थित हैं। पहचाने गए NuGet, Maven/Gradle, RubyGems, Dart और Composer publishers को अतिरिक्त verification support चाहिए; private registries और बाहरी reusable workflows को भी अतिरिक्त support चाहिए। अधूरी file inventory और अपठनीय फ़ाइलें त्रुटियाँ बनी रहती हैं।

Monitor merge के बाद delayed workflows के लिए एक मिनट देता है, CI के लिए अधिकतम एक घंटा प्रतीक्षा करता है और workflows पूर्ण होने के बाद outputs दिखाई देने के लिए पाँच मिनट देता है। `--verbose` polling और evidence diagnostics दिखाता है।

Verification विफल होने पर solver मौजूदा `/fix --ci-cd` template से Bug issue बनाता है, जिसमें target commit, workflow failures और अनुपलब्ध output evidence शामिल होते हैं। वह `--development-log --deep-analysis --auto-merge` के साथ issue हल करता है और `--tool`, `--model`, `--think` जैसे worker options रखता है। हर repair मूल target branch पर नया checkout और tool session उपयोग करता है। Repair पूर्ण होने पर parent फिर CI/CD जाँचता है; child solvers दूसरी repair chain नहीं शुरू करते।

Repairs parent solve का साझा `--auto-restart-max-iterations` budget उपयोग करते हैं (डिफ़ॉल्ट: 5)। असीमित repair chain के लिए इसे `0` रखें। Budget समाप्त होने, child विफल होने, target branch अपरिवर्तित रहने या interruption पर command विफल होता है और remediation issue/PR जाँच के लिए उपलब्ध रहता है।

GitHub API संदर्भ: [releases](https://docs.github.com/en/rest/releases/releases), [deployment statuses](https://docs.github.com/en/rest/deployments/statuses), [Pages builds](https://docs.github.com/en/rest/pages/pages), और [commit comparison](https://docs.github.com/en/rest/commits/commits#compare-two-commits)।
