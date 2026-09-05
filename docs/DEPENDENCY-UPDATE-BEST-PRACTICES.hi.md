# AI-संचालित विकास के लिए Dependency अपडेट की सर्वोत्तम प्रथाएँ (languages: [en](DEPENDENCY-UPDATE-BEST-PRACTICES.md) • [zh](DEPENDENCY-UPDATE-BEST-PRACTICES.zh.md) • hi • [ru](DEPENDENCY-UPDATE-BEST-PRACTICES.ru.md))

यह दस्तावेज़ बताता है कि किसी repository की सभी dependencies को — उसमें उपयोग की जाने वाली हर भाषा में — नवीनतम संस्करण तक कैसे लाया जाए और उन्हें वहीं कैसे बनाए रखा जाए। `fix <repository-url> --update-all-dependencies` द्वारा बनाया गया हर issue और `solve`, `hive` तथा Telegram bot द्वारा जोड़ा गया `--update-all-dependencies` prompt इसी दस्तावेज़ का संदर्भ देते हैं, इसलिए नीचे दी गई प्रथाएँ ठीक वही हैं जिनका पालन करने के लिए AI solver से कहा जाता है।

## AI विकास के लिए Dependency अपडेट क्यों मायने रखते हैं

पुरानी dependency tree की कीमत उन security advisories से कहीं अधिक है जिनकी चर्चा सब करते हैं:

1. **मॉडल पुराने API के साथ काम करता है।** AI solver उसी संस्करण के लिए code लिखता है जो उसे installed मिलता है। चार साल तक pinned संस्करणों का अर्थ है चार साल के workarounds, जिन्हें वर्तमान release ने अनावश्यक बना दिया है।
2. **हाथ से लिखा code जमा होता जाता है।** किसी परिपक्व repository में लगभग हर "छोटा helper" इसलिए मौजूद है क्योंकि _उस समय_ dependency में वह सुविधा नहीं थी। आमतौर पर अब वह मौजूद है।
3. **Advisories चुपचाप जमा होती रहती हैं।** `dependency-review-action` केवल उन dependencies की जाँच करता है जिन्हें कोई pull request _बदलता_ है। एक साल पहले pin किए गए package के लिए प्रकाशित advisory उसके लिए हमेशा अदृश्य रहती है ([जो tree आप वास्तव में भेजते हैं उसका audit करें](#9-जो-tree-आप-वास्तव-में-भेजते-हैं-उसका-audit-करें) देखें)।
4. **पिछड़ापन ठीक न किए जा सकने योग्य हो जाता है।** छह major संस्करण पीछे रहना एक major पीछे रहने से छह गुना काम नहीं है; migration guides यह मानकर चलते हैं कि आप पिछले release से आए हैं।

सब कुछ एक साथ, सोच-समझकर अपडेट करना उससे सस्ता है कि तब तक कुछ भी अपडेट न किया जाए जब तक कोई मजबूरी न आ जाए।

## "सभी Dependencies" का अर्थ

"सभी" का अर्थ शाब्दिक है। dependency वह हर चीज़ है जिसे build repository के बाहर से लेता है:

| श्रेणी                         | उदाहरण                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Runtime dependencies           | `dependencies`, `[dependencies]`, `require`, `install_requires`               |
| Development dependencies       | test runners, linters, formatters, type checkers, build plugins               |
| Lockfile की transitive entries | `package-lock.json`, `Cargo.lock`, `uv.lock`, `composer.lock`, `Gemfile.lock` |
| Base images                    | हर `Dockerfile`, `docker-compose.yml`, `devcontainer.json` का हर `FROM`       |
| CI/CD actions                  | `.github/workflows/*.yml` और composite `action.yml` का हर `uses:`             |
| Toolchains और भाषा के pins     | `engines`, `rust-version`, `go` directive, `TargetFramework`, `.nvmrc`        |
| Infrastructure modules         | Terraform modules और providers, Helm chart dependencies, git submodules       |
| Pre-commit hooks               | `.pre-commit-config.yaml` की revisions                                        |

यदि repository में कहीं भी कोई version संख्या लिखी है, तो वह इस काम के दायरे में है।

## प्रति-Ecosystem अपडेट कमांड

अधिकांश package managers का डिफ़ॉल्ट कमांड जानबूझकर manifest में पहले से लिखी बाधाओं के **भीतर** ही रहता है, इसलिए वह कभी major संस्करण पार नहीं करता। दाईं ओर का कॉलम वह कमांड है जो वास्तव में बाधाओं को फिर से लिखता है। हर कमांड को उसी tool के अपने दस्तावेज़ के विरुद्ध सत्यापित किया गया है; उद्धरण [`docs/case-studies/issue-2184/data/ecosystem-update-commands.json`](./case-studies/issue-2184/data/ecosystem-update-commands.json) में हैं।

| Ecosystem             | बाधाओं के भीतर रहता है           | नवीनतम तक अपडेट करता है, major पार करते हुए                                          |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| JavaScript/TypeScript | `npm update`                     | `npx npm-check-updates -u && npm install`                                            |
| Python                | `pip install -U`                 | `uv lock --upgrade` • `pip-compile --upgrade` • `poetry update`                      |
| Rust                  | `cargo update`                   | `cargo upgrade --incompatible && cargo update` (cargo-edit)                          |
| Go                    | —                                | `go get -u ./... && go mod tidy`                                                     |
| C#/.NET               | `dotnet list package --outdated` | `dotnet outdated -u` (dotnet-outdated)                                               |
| Java/Kotlin/Scala     | `./gradlew dependencyUpdates`    | `mvn versions:use-latest-releases versions:update-properties`                        |
| PHP                   | `composer update`                | पहले `composer require vendor/pkg:^X`, फिर `composer update --with-all-dependencies` |
| Ruby                  | `bundle update`                  | Gemfile की बाधाएँ बढ़ाने के बाद `bundle update --all`                                |
| Elixir/Erlang         | `mix deps.update --all`          | `mix.exs` संपादित करें, फिर `mix deps.update --all`                                  |
| Dart/Flutter          | `dart pub upgrade`               | `dart pub upgrade --major-versions`                                                  |
| Swift                 | `swift package update`           | `Package.swift` की requirements संपादित करें, फिर `swift package update`             |
| Haskell               | `cabal outdated`                 | `cabal update` • `stack upgrade --resolver latest`                                   |
| GitHub Actions        | —                                | हर `uses:` को नवीनतम release तक बढ़ाएँ (tag या pinned digest)                        |
| Docker                | —                                | हर `FROM` tag बढ़ाएँ और digest फिर से pin करें                                       |
| Infrastructure        | —                                | `terraform init -upgrade` • `helm dependency update` • `pre-commit autoupdate`       |

उस तालिका में तीन जाल छिपे हैं:

- **`npm update` कभी major पार नहीं करता।** यह `package.json` की `^`/`~` ranges के भीतर ही resolve करता है। केवल `npm-check-updates -u` उन ranges को स्वयं फिर से लिखता है; `--target latest` उसका डिफ़ॉल्ट है।
- **`cargo update --breaking` केवल nightly पर है** (`-Z unstable-options`)। stable पर major पार करने का रास्ता `cargo-edit` का `cargo upgrade --incompatible` है।
- **Maven versions को `<properties>` में pin करता है।** अकेला `versions:use-latest-releases` property में pin किए गए हर version को पीछे छोड़ देता है — उसी invocation में `versions:update-properties` भी चलाएँ।

## मुख्य सिद्धांत

### 1. कुछ भी बदलने से पहले एक तालिका बनाएँ

हर ecosystem के लिए, हर dependency को आज pin किए गए version और आज जारी किए गए version के साथ सूचीबद्ध करें, **version registry से resolve करें, स्मृति से नहीं**। मॉडल के training data की एक cutoff तिथि होती है; registry की नहीं। `npm view <pkg> version`, `cargo search`, `pip index versions`, `gh release list` या अपने ecosystem के समतुल्य कमांड का उपयोग करें।

यही तालिका परिणाम को समीक्षा-योग्य बनाती है: पाठक एक नज़र में देख सकता है कि क्या बदला, क्या नहीं बदला और क्या छोड़ा गया।

### 2. जो कुछ पीछे छोड़ा गया है उसका लिखित कारण होना चाहिए

पुराने version पर बनी रही dependency एक निर्णय है, और निर्णय दर्ज किए जाते हैं — link सहित कोई upstream bug, हटाया गया platform, कोई paid tier, या कोई peer dependency जो अभी पीछे है। मौन और चूक में कोई अंतर नहीं दिखता, और अगला व्यक्ति इसे दोबारा समझने में एक घंटा लगाएगा।

### 3. Major संस्करण सोच-समझकर पार करें

हर major bump के लिए: changelog और migration guide पढ़ें, code को नए API के अनुरूप ढालें, और उन shims को हटाएँ जिनकी ज़रूरत पुराने version को थी।

**किसी major को "pass" कराने के लिए ढीली की गई बाधा या skip किया गया test अपडेट नहीं है।** दो anti-patterns जिन पर नज़र रखें:

```diff
- "some-lib": "^3.0.0"
+ "some-lib": "*"          # अपडेट नहीं: एक range जो समस्या छिपा देती है
```

```diff
- it('serialises nested nodes', () => { ... })
+ it.skip('serialises nested nodes', () => { ... })   # अपडेट नहीं: एक हटाया गया संकेत
```

### 4. नई सुविधाएँ अपनाएँ और हाथ से लिखी प्रतियाँ हटाएँ

यह सबसे अधिक लाभ देने वाला सिद्धांत है और सबसे अधिक बार छोड़ा जाने वाला भी। जब कोई नया version वह चीज़ देता है जिसे repository हाथ से लागू करती है, तो स्थानीय प्रति हटाएँ और upstream सुविधा का उपयोग करें। ठोस रूप में:

- कोई स्थानीय `deepMerge`/`retry`/`debounce` helper जिसे library अब export करती है,
- किसी platform API का polyfill जो नई runtime baseline में मौजूद है,
- कोई custom CLI parser जिसे framework अब स्वयं संभालता है,
- कोई स्वयं बनाया cache जो client library में अब मूल रूप से आ गया है।

**अपडेट के बाद duplicated code और logic पहले से कम होना चाहिए।** यदि diff में केवल version संख्याएँ बदलती हैं, तो अपडेट पूरा नहीं हुआ।

### 5. बाधाओं को ईमानदार बनाएँ

- **उन floors को बढ़ाएँ** जो वास्तव में installed संस्करण से वर्षों पीछे हैं। lockfile में `4.2` होते हुए `>=1.0` का floor का अर्थ है कि CI और एक नया `pip install` एक ही tree का परीक्षण नहीं कर रहे।
- **उन upper bounds को हटाएँ** जो वर्तमान release को बाहर करते हैं। जब `4` वर्तमान था तब लिखा गया `<5` एक ऐसी सीमा है जिसे किसी ने तय नहीं किया।
- **हर lockfile फिर से generate करें और commit करें।** अपडेटेड manifest के साथ पुराना lockfile वाली repository वह है जहाँ CI का परिणाम और उपभोक्ता का install आपस में असहमत हैं।

### 6. पूरी repository में हर dependency का एक ही version

यदि एक ही dependency एक से अधिक जगह pin की गई है — एक ही protocol के कई भाषा-कार्यान्वयन, कोई `Dockerfile`, कोई workflow, दस्तावेज़ का कोई snippet — तो हर pin को एक ही version पर लाएँ। जो repository एक library को चार अलग संस्करणों पर pin करती है, उसके चार अलग व्यवहार होते हैं और वह उनमें से केवल एक का परीक्षण करती है।

### 7. केवल packages नहीं, toolchain भी अपडेट करें

भाषा का संस्करण भी एक dependency है:

- `engines.node` / `.nvmrc` / `actions/setup-node@v5` का `node-version`
- `Cargo.toml` में `rust-version` और `edition`
- `go.mod` में `go` directive
- `*.csproj` में `TargetFramework`, और `global.json`
- `maven.compiler.source`/`target`, Gradle wrapper का version
- `pyproject.toml` में `requires-python`

test SDK या assertion library का major आमतौर पर toolchain के साथ ही बदलता है, इसलिए उन्हें एक ही pass में अपडेट करें।

### 8. हरा CI और शून्य नई deprecation चेतावनियाँ

अपडेट के बाद **हर** ecosystem का पूरा build, test और lint suite चलाएँ — केवल उसका नहीं जिसे आपने अंत में बदला — और CI को हरा करें। फिर उन deprecation चेतावनियों को हल करें जो अपडेट ने पैदा कीं। आज छोड़ी गई चेतावनी वही breaking change है जो अगले अपडेट को रोक देगी।

### 9. जो tree आप वास्तव में भेजते हैं उसका audit करें

अपडेट के बाद, परिणामी tree की advisories जाँचें:

```bash
npm audit --package-lock-only --audit-level=high   # JavaScript/TypeScript
cargo audit                                        # Rust
pip-audit                                          # Python
bundle audit                                       # Ruby
dotnet list package --vulnerable                   # C#/.NET
govulncheck ./...                                  # Go
```

`--package-lock-only` महत्वपूर्ण है: यह lockfile का **जैसा वह commit किया गया है वैसा ही** audit करता है, इसलिए परिणाम वही होता है जो उपभोक्ता को मिलेगा, और उसे ऐसे resolution से हरा नहीं किया जा सकता जो केवल इसी runner पर होता है। समतुल्य job को schedule पर रखें, क्योंकि केवल scheduled run ही ऐसी advisory देख सकता है जो code बदलना बंद होने के बाद प्रकाशित हुई हो। workflow job स्वयं के लिए [CI/CD सर्वोत्तम प्रथाएँ](./CI-CD-BEST-PRACTICES.hi.md) देखें।

### 10. रुकावटों की सूचना upstream दें

जब कोई अपडेट किसी dependency के bug से रुका हो, तो उस project के GitHub पर एक issue खोलें जिसमें पुनरुत्पादन योग्य उदाहरण, यहाँ अपनाया गया workaround और code में सुझाया गया fix हो — फिर चुपचाप version वापस pin करने के बजाय उस report को अपने काम से link करें। link सहित pin एक ट्रैक किया गया निर्णय है; बिना link वाला pin स्थायी है।

## इसे स्वतः अद्यतन बनाए रखना

एक बार अपडेट करके रुक जाना एक साल में वही backlog फिर से पैदा करता है। एक updater कॉन्फ़िगर करें ताकि अगला पिछड़ापन एक और issue के बजाय pull request के रूप में आए।

### Dependabot

Dependabot 33 `package-ecosystem` मान स्वीकार करता है, जो ऊपर की तालिका के हर ecosystem को (Haskell को छोड़कर) कवर करते हैं। **हर ecosystem और हर directory के लिए** एक `updates:` entry चाहिए — तीन `package.json` वाली monorepo को तीन `npm` entries चाहिए।

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      all-dependencies:
        patterns: ['*']
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
```

अधिकांश काम दो settings करती हैं:

- **`groups`** दर्जनों single-dependency pull requests को एक में समेट देता है, जिससे CI की लागत और समीक्षा की लागत दोनों सीमित रहती हैं।
- **`open-pull-requests-limit`** (डिफ़ॉल्ट 5) सीमा पर पहुँचने के बाद चुपचाप नए pull requests खोलना बंद कर देता है — यदि लगता है कि Dependabot रुक गया है, तो कारण आमतौर पर यही होता है।

ध्यान दें कि अकेला Dependabot सिद्धांत 3 और 4 में वर्णित काम नहीं करेगा: वह version बढ़ाता है और रुक जाता है। वह छोटे पिछड़ेपन को जमा होने से रोकता है; वह न API migrate करता है, न कोई shim हटाता है।

### Renovate

[Renovate](https://github.com/renovatebot/renovate) managers के व्यापक समूह को कवर करता है और self-hosted किया जा सकता है। इसका `rangeStrategy: bump` और grouping presets वही उद्देश्य पूरा करते हैं जो ऊपर का कॉन्फ़िगरेशन; दोनों चलाने के बजाय एक updater चुनें और उसे ठीक से कॉन्फ़िगर करें।

## स्वचालित Dependency Remediation

इसमें से कुछ भी हाथ से करने की ज़रूरत नहीं है। `fix` कमांड पूरी प्रक्रिया को स्वचालित करता है, ठीक वैसे ही जैसे `fix --ci-cd` pipelines के लिए करता है:

```bash
fix https://github.com/owner/repo --update-all-dependencies
```

यह कमांड:

1. **repository की भाषाओं का पता लगाता है**, GitHub Linguist API (`GET /repos/{owner}/{repo}/languages`) से, प्रति भाषा bytes के क्रम में।
2. **default branch की file tree सूचीबद्ध करता है** (`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`) और हर committed manifest और lockfile खोजता है, `node_modules/`, `vendor/`, `.venv/` और `target/` जैसी vendored directories छोड़ते हुए।
3. **दोनों संकेतों को package ecosystems पर मैप करता है।** अकेला कोई भी संकेत गलत है: Linguist उन ecosystems को नहीं देखता जिनका अपना source code नहीं है (GitHub Actions, Docker, Terraform), और manifests उस भाषा को नहीं देखते जिसका manifest असामान्य या अनुपस्थित है।
4. **एक maintenance issue बनाता है** जिसमें हर पहचाना गया ecosystem, मिले हुए manifests, फिर से generate किए जाने वाले lockfiles, वहाँ major पार करने वाला कमांड, Dependabot कॉन्फ़िगरेशन का संकेत, और ऊपर के सिद्धांतों से बना standard prompt सूचीबद्ध होते हैं। issue **Task** प्रकार और `dependencies` label के साथ बनाया जाता है।
5. **issue को `/solve --development-log --deep-analysis --auto-merge --update-all-dependencies` को सौंपता है**, जो अपडेट merge होने तक iterate करता है। हर वह option जिसे `fix` स्वयं उपभोग नहीं करता (उदाहरण के लिए `--tool`, `--model`, `--think`) `/solve` को अग्रेषित किया जाता है।

issue बनाए बिना उसका पूर्वावलोकन करने के लिए `--dry-run` का उपयोग करें, और `/solve` शुरू किए बिना issue बनाने के लिए `--no-solve` का:

```bash
fix owner/repo --update-all-dependencies --dry-run
fix owner/repo --update-all-dependencies --no-solve
```

### issue Task क्यों है, और वह क्या छोड़ता है

`/solve --deep-analysis` मूल-कारण और debug-output संबंधी मार्गदर्शन **केवल bug-प्रकार के issues के लिए** देता है, और dependency bump में खोजने के लिए कोई मूल कारण नहीं होता। issue को `Task` के रूप में बनाना उस prompt का non-bug रूप चुनता है — शोध, आवश्यकताओं की कवरेज, समाधान की योजना — जो यहाँ उपयोगी है। issue types संगठन-स्तर पर और labels repository-स्तर पर कॉन्फ़िगर होते हैं, इसलिए यदि लक्ष्य repository इनमें से कोई भी स्वीकार नहीं करती, तब भी issue उनके बिना बना दिया जाता है।

`--deep-analysis` [सिद्धांत 10](#10-रुकावटों-की-सूचना-upstream-दें) का upstream-रिपोर्टिंग मार्गदर्शन भी देता है, इसलिए `fix` उस अनुच्छेद को issue के मुख्य भाग से हटा देता है ताकि वह दो बार न पहुँचे। बाकी हर अनुच्छेद बिना शर्त शामिल होता है।

## `--update-all-dependencies` विकल्प

वही prompt हर उस कमांड में विकल्प के रूप में उपलब्ध है जो कोई solver चलाता है, और डिफ़ॉल्ट रूप से बंद है:

```bash
solve https://github.com/owner/repo/issues/123 --update-all-dependencies
hive https://github.com/owner/repo --update-all-dependencies
```

Telegram bot में यह flag `/solve`, `/hive`, `/fix` और `/task` पर उसी रूप में स्वीकार किया जाता है।

इसे चालू करने पर solver के system prompt में एक dependency-अपडेट अनुभाग जुड़ जाता है, जिससे issue जिस काम की माँग करता है वह हर dependency को वर्तमान बनाते हुए **साथ-साथ** पूरा होता है, न कि किसी पुरानी tree के ऊपर। यह डिफ़ॉल्ट रूप से बंद है क्योंकि किसी असंबंधित bug fix में बिना माँगी गई dependency migration जोड़ देना pull request को समीक्षा-अयोग्य बना देता है — इसे तब चालू करें जब अपडेट आपकी अपेक्षा का हिस्सा हो, या जब अपडेट ही पूरा उद्देश्य हो तो `fix --update-all-dependencies` का उपयोग करें।

`--tool claude`, `--tool codex`, `--tool opencode`, `--tool agent`, `--tool qwen` और `--tool gemini` के लिए समर्थित।

## संदर्भ

- [CI/CD सर्वोत्तम प्रथाएँ](./CI-CD-BEST-PRACTICES.hi.md)
- [कॉन्फ़िगरेशन संदर्भ](./CONFIGURATION.hi.md)
- [केस स्टडी: issue #2184](./case-studies/issue-2184/README.md)
- [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- [npm-check-updates](https://github.com/raineorshine/npm-check-updates)
- [cargo-edit](https://github.com/killercup/cargo-edit)
- [versions-maven-plugin](https://www.mojohaus.org/versions/versions-maven-plugin/index.html)
