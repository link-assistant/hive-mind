# AI-संचालित विकास के लिए CI/CD सर्वोत्तम प्रथाएँ (languages: [en](CI-CD-BEST-PRACTICES.md) • [zh](CI-CD-BEST-PRACTICES.zh.md) • hi • [ru](CI-CD-BEST-PRACTICES.ru.md))

यह दस्तावेज़ उन CI/CD सर्वोत्तम प्रथाओं का वर्णन करता है जो AI-संचालित development workflows की गुणवत्ता और विश्वसनीयता में महत्वपूर्ण सुधार करती हैं। सही तरीके से कॉन्फ़िगर किए जाने पर, Hive Mind AI solvers को CI/CD checks के साथ iterate करने के लिए मजबूर किया जाता है जब तक कि सभी tests pass न हो जाएँ, यह सुनिश्चित करते हुए कि code quality उच्चतम मानकों को पूरा करती है।

## AI विकास के लिए CI/CD क्यों महत्वपूर्ण है

Hive Mind का AI issue solver प्रत्येक pull request में CI/CD checks पर ध्यान देने के लिए निर्देशित है। यह एक शक्तिशाली feedback loop बनाता है:

1. **AI एक समाधान बनाता है** - Solver issue requirements के आधार पर code generate करता है
2. **CI/CD समाधान validate करता है** - Automated checks code quality verify करते हैं
3. **AI pass होने तक iterate करता है** - Solver issues को तब तक ठीक करता है जब तक सभी checks pass न हो जाएँ
4. **गुणवत्ता की गारंटी है** - सभी gates pass किए बिना कोई code merge नहीं होता

यह दृष्टिकोण सुनिश्चित करता है कि चाहे team में humans हों, AIs हों या दोनों, consistent quality बनी रहे।

## अनुशंसित CI/CD Templates

हम सभी सर्वोत्तम प्रथाओं के साथ पूर्व-कॉन्फ़िगर किए गए कई भाषाओं के लिए ready-to-use templates प्रदान करते हैं:

| भाषा                  | Template Repository                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript/TypeScript | [js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template)         |
| Rust                  | [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)     |
| Python                | [python-ai-driven-development-pipeline-template](https://github.com/link-foundation/python-ai-driven-development-pipeline-template) |
| Go                    | [go-ai-driven-development-pipeline-template](https://github.com/link-foundation/go-ai-driven-development-pipeline-template)         |
| C#                    | [csharp-ai-driven-development-pipeline-template](https://github.com/link-foundation/csharp-ai-driven-development-pipeline-template) |
| Java                  | [java-ai-driven-development-pipeline-template](https://github.com/link-foundation/java-ai-driven-development-pipeline-template)     |
| PHP                   | [php-ai-driven-development-pipeline-template](https://github.com/link-foundation/php-ai-driven-development-pipeline-template)       |

> **सुझाव:** आपको template हाथ से चुनने की आवश्यकता नहीं है। `fix <repository-url> --ci-cd` चलाएं ([Automatic CI/CD Remediation](#automatic-cicd-remediation) देखें) और Hive Mind repository की भाषाओं का पता लगाकर आपके लिए मेल खाते templates का चयन कर लेता है।

## मुख्य CI/CD सिद्धांत

### 1. केवल संबंधित फ़ाइल परिवर्तनों पर ही Checks चलाएं

**केवल तभी checks trigger करें जब संबंधित फ़ाइलें बदलें।** यह CI लागत और run times को नाटकीय रूप से कम करता है।

अपने workflow की शुरुआत में `detect-changes` job का उपयोग करें यह निर्धारित करने के लिए कि कौन सी file categories बदलीं:

```yaml
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      code-changed: ${{ steps.changes.outputs.code }}
      docs-changed: ${{ steps.changes.outputs.docs }}
      docker-changed: ${{ steps.changes.outputs.docker }}
      workflow-changed: ${{ steps.changes.outputs.workflow }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - name: Detect changes
        id: changes
        run: node scripts/detect-code-changes.mjs
```

फिर प्रत्येक job को संबंधित output पर gate करें:

```yaml
test-suites:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.code-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
  # ...

validate-docs:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  # ...

docker-pr-check:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docker-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
  # ...
```

**"code changes" detection से क्या exclude करें:**

- Markdown files (`*.md`) — documentation-only changes को changeset files की आवश्यकता नहीं है
- `.changeset/` folder — changeset metadata code नहीं है
- `data/` और `experiments/` folders — non-production content
- `.gitkeep` files — कोई functional impact नहीं वाली placeholder files

**बदलने पर हमेशा checks trigger करने वाली चीज़ें:**

- Source code files (`.mjs`, `.ts`, `.py`, `.rs`, `.go`, आदि)
- `package.json` / dependency manifests
- CI/CD workflow files (`.github/workflows/*.yml`)
- `Dockerfile` और संबंधित infrastructure files

### 2. फ़ाइल आकार सीमाएँ

**प्रति code file अधिकतम 1000-1500 lines लागू करें।**

यह constraint AI और human दोनों developers के लिए फायदेमंद है:

- AI models पूरी फ़ाइलें context windows के भीतर पढ़ और समझ सकते हैं
- Humans cognitive overload के बिना फ़ाइलों को navigate और comprehend कर सकते हैं
- Modular, well-organized code architecture के लिए मजबूर करता है

CI में उदाहरण enforcement (bash):

```bash
find src/ -name "*.mjs" -type f | while read -r file; do
  line_count=$(wc -l < "$file")
  if [ "$line_count" -gt 1500 ]; then
    echo "ERROR: $file has $line_count lines (limit: 1500)"
    echo "::error file=$file::File has $line_count lines (limit: 1500)"
    exit 1
  fi
done
```

**CI से पहले locally उल्लंघन पकड़ने के लिए file-size ESLint rule को CI check के साथ synchronize करें:**

```js
// eslint.config.mjs
{
  rules: {
    'max-lines': ['error', { max: 1500 }]
  }
}
```

### 3. Automated Code Formatting

Consistent formatting style debates को समाप्त करती है और diff noise कम करती है:

| भाषा                  | Tool                          |
| --------------------- | ----------------------------- |
| JavaScript/TypeScript | ESLint + Prettier             |
| Rust                  | rustfmt                       |
| Python                | Ruff                          |
| Go                    | gofmt                         |
| C#                    | dotnet format                 |
| Java                  | Spotless (Google Java Format) |
| PHP                   | PHP CS Fixer                  |

सभी templates में pre-commit hooks शामिल हैं जो प्रत्येक commit से पहले automatically formatters चलाते हैं।

### 4. Static Analysis और Linting

Code review तक पहुँचने से पहले bugs पकड़ें और patterns लागू करें:

| भाषा                  | Tools                               |
| --------------------- | ----------------------------------- |
| JavaScript/TypeScript | ESLint with strict rules            |
| Rust                  | Clippy (pedantic + nursery)         |
| Python                | Ruff + mypy                         |
| Go                    | go vet + staticcheck                |
| C#                    | .NET analyzers (warnings as errors) |
| Java                  | SpotBugs (maximum effort)           |
| PHP                   | PHPStan (max level)                 |

### 5. Fast-Fail Job Ordering

**सबसे तेज़ possible feedback देने के लिए slow checks से पहले fast checks चलाएं:**

```
Fast checks (~7-30s each):     Slow checks (~1-10 min each):
├── test-compilation            ├── test-suites (unit tests)
├── lint (format + ESLint)      ├── test-execution (integration)
└── check-file-line-limits      ├── docker-pr-check
                                └── helm-pr-check
```

Fast checks पर slow checks gate करें:

```yaml
test-suites:
  needs: [test-compilation, lint, check-file-line-limits]
  if: |
    always() &&
    !cancelled() &&
    !contains(needs.*.result, 'failure') &&
    needs.test-compilation.result == 'success' &&
    needs.lint.result == 'success' &&
    needs.check-file-line-limits.result == 'success'
```

### 6. Changeset-Based Versioning

सभी templates एक changeset system उपयोग करते हैं जो:

- **Merge conflicts समाप्त करता है** - प्रत्येक PR एक independent changeset file बनाता है
- **Version bumps automate करता है** - Merging करते समय highest bump type जीतता है
- **Changelogs generate करता है** - Release notes automatically compiled होते हैं
- **Semantic versioning का समर्थन करता है** - patch/minor/major bumps explicit हैं

| भाषा                  | Tool                         |
| --------------------- | ---------------------------- |
| JavaScript/TypeScript | @changesets/cli              |
| Rust                  | changelog.d + custom scripts |
| Python                | Scriv                        |
| PHP                   | changelog.d + custom scripts |
| Go, C#, Java          | Custom changeset workflows   |

**Docs-only PRs को changeset requirements से exempt करें:**

```yaml
changeset-check:
  needs: [detect-changes]
  if: github.event_name == 'pull_request' && needs.detect-changes.outputs.any-code-changed == 'true'
```

Documentation-only changes (`.md` files update करना) के लिए version bump की आवश्यकता नहीं होनी चाहिए।

### 7. Actual Merge Result Validate करें

**CI को वह test करना चाहिए जो actually merge होगा, न कि एक stale PR snapshot।**

जब किसी base branch पर PR खोला जाता है और बाद में base branch को नए commits मिलते हैं, तो GitHub merge preview stale हो सकती है। Checks चलाने से पहले fresh merge simulate करें:

```yaml
- name: Simulate fresh merge with base branch (PR only)
  if: github.event_name == 'pull_request'
  env:
    BASE_REF: ${{ github.base_ref }}
  run: |
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git config user.name "github-actions[bot]"
    git fetch origin "$BASE_REF"
    BEHIND_COUNT=$(git rev-list --count HEAD..origin/$BASE_REF)
    if [ "$BEHIND_COUNT" -gt 0 ]; then
      git merge origin/$BASE_REF --no-edit || \
        (echo "::error::Merge conflict! PR must be rebased before merging." && exit 1)
    fi
```

यह सुनिश्चित करता है कि lint, file-size और अन्य checks final merged state को validate करें।

### 8. Pre-commit Hooks

Local quality gates टूटे हुए commits को CI तक पहुँचने से रोकते हैं:

1. Format check और auto-fix
2. Lint और static analysis
3. Type checking (जहाँ लागू हो)
4. File size validation
5. Secrets detection

यह "shift left" दृष्टिकोण CI की प्रतीक्षा करने के बजाय तुरंत issues पकड़ता है।

### 9. Release Automation

Automated release workflows सुनिश्चित करते हैं:

- **कोई manual version management नहीं** - Versions automatically update होते हैं
- **OIDC trusted publishing** - CI में कोई API tokens आवश्यक नहीं (npm, PyPI, crates.io)
- **केवल validated releases** - Publishing से पहले सभी checks pass होने चाहिए
- **Dual trigger modes** - Automatic (on merge) और manual (workflow dispatch) दोनों

**PRs में manual version changes prohibit करें** — सभी version bumps CI release workflow द्वारा प्रबंधित होने चाहिए:

```yaml
version-check:
  if: github.event_name == 'pull_request'
  steps:
    - name: Check for version changes in package.json
      run: node scripts/check-version.mjs
```

### 10. Concurrency Control

**रद्द किए जा सकने वाले read-only checks को रद्द न किए जाने वाले write jobs से अलग रखें।** जब किसी workflow में दोनों तरह के काम हों, तब concurrency को job level पर configure करें:

```yaml
jobs:
  lint:
    # Job की पहचान (और मौजूद होने पर matrix values) शामिल करें, ताकि असंबंधित
    # checks parallel चलें और नया run केवल उसी पुराने check को बदले।
    concurrency:
      group: check-${{ github.workflow }}-${{ github.ref }}-lint
      cancel-in-progress: true
    # ...

  deploy:
    needs: [lint]
    if: ${{ !cancelled() && needs.lint.result == 'success' }}
    # main या किसी external deployment target पर लिखने वाले सभी jobs इस
    # repository-wide group का उपयोग करें, भले वे अलग workflows में हों।
    concurrency:
      group: main-writer-${{ github.repository }}-main
      cancel-in-progress: false
    # ...
```

- **Read-only jobs:** Runner load घटाने के लिए pull requests और `main`, दोनों पर पुराने checks रद्द करें। हर job को अलग suffix दें; matrix entries को parallel रखने के लिए संबंधित matrix values भी जोड़ें।
- **Dependent writers:** `needs` उपयोग करें और prerequisites की सफलता आवश्यक रखें। रद्द हुए prerequisite के बाद उसका write job शुरू नहीं होना चाहिए।
- **Active writers:** हर release, deploy, tag, generated-content push और दूसरे write job को `cancel-in-progress: false` वाला एक ही repository-scoped group दें। पहले से शुरू writer पूरा होता है और अगला writer queue में प्रतीक्षा करता है, चाहे वह किसी दूसरे workflow file से आया हो।
- **Workflow scope:** Write jobs वाले workflow पर cancellable concurrency को workflow level पर न लगाएँ। ऐसा करने से पहले से शुरू writer भी रद्द हो जाएगा।

Default रूप से concurrency group में अधिकतम एक running और एक pending job रहता है; नया pending writer पुराने pending writer को बदल देता है। यदि हर queued write चलना आवश्यक है, तो writer के concurrency block में `queue: max` जोड़ें (अधिकतम 100 jobs प्रतीक्षा कर सकते हैं)। `queue: max` को `cancel-in-progress: true` के साथ उपयोग नहीं किया जा सकता, और execution order workflow dispatch order के बजाय jobs के प्रतीक्षा शुरू करने के समय पर आधारित होता है; इसलिए write jobs idempotent होने चाहिए।

Job conditions में `always()` के बजाय `!cancelled()` उपयोग करें ताकि cancellation job graph में सही ढंग से propagate हो। केवल `always()` लगाने से cancellation के बाद भी downstream work चल सकता है।

### 11. Secrets Detection

CI में accidental credential leaks रोकें:

- `secretlint` या `truffleHog` जैसे tools का उपयोग करके secrets scan step शामिल करें
- Secrets detect होने पर CI तुरंत fail करें
- Environment variables या token values कभी log न करें

### 12. Documentation Validation

**CI में documentation files को code की तरह ही validate करें:**

- File size limits check करें (जैसे, docs के लिए अधिकतम 2500 lines)
- Key documents में required sections मौजूद हैं verify करें
- `lychee` जैसे tools का उपयोग करके broken links check करें

```yaml
validate-docs:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  steps:
    - run: node tests/docs-validation.mjs
```

### 13. कंटेनर इमेज: प्रत्येक आर्किटेक्चर के लिए नेटिव रनर

**हर architecture को उसके अपने native runner पर बनाएँ।** GitHub public repositories के लिए मुफ़्त arm64 Linux runners (`ubuntu-24.04-arm`) देता है। x86 runner पर QEMU से arm64 emulation बहुत धीमा होता है और एक job में दोनों builds parallel के बजाय sequential चलते हैं।

```yaml
build-image:
  strategy:
    matrix:
      include:
        - platform: linux/amd64
          runner: ubuntu-latest
        - platform: linux/arm64
          runner: ubuntu-24.04-arm
  runs-on: ${{ matrix.runner }}
  steps:
    - uses: docker/build-push-action@v7
      with:
        platforms: ${{ matrix.platform }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
        outputs: type=image,push-by-digest=true,name-canonical=true,push=true

merge-manifest:
  needs: [build-image]
  steps:
    - run: docker buildx imagetools create -t $IMAGE:$VERSION $DIGESTS
```

- **`setup-qemu-action` का उपयोग न करें।** यह architecture emulation दर्शाता है; native runner उपयोग करें।
- **Users के हर architecture के लिए images प्रकाशित करें।** Single-architecture image Apple Silicon, Graviton और arm CI runners को बाहर कर देती है।
- **हमेशा cache करें।** हर build step पर `cache-from: type=gha` और `cache-to: type=gha,mode=max` सेट करें।
- **Release को image push पर निर्भर न करें।** पहले GitHub Release और language-registry package प्रकाशित करें, फिर images तैयार होने पर जोड़ें।
- **प्रकाशित परिणाम जाँचें।** Manifest में हर अपेक्षित platform और default branch के हर tag का GitHub Release होना चाहिए।

संदर्भ implementations: [`link-foundation/box`](https://github.com/link-foundation/box) और [`link-assistant/hive-mind`](https://github.com/link-assistant/hive-mind)।

### 14. Workflows को स्वयं Lint करें

**Pipeline भी code है, और default रूप से उसे कोई lint नहीं करता।** Workflow files में shell quoting bugs, अत्यधिक व्यापक `permissions`, unpinned actions और template-injection sinks जमा होते रहते हैं जिन्हें pipeline का कोई job नहीं देखता — क्योंकि हर job application को जाँचने में व्यस्त है।

`.github/` में परिवर्तन पर trigger होने वाले अपने अलग workflow में दो पूरक tools:

- [`actionlint`](https://github.com/rhysd/actionlint) — syntax, expressions, और (सबसे महत्वपूर्ण) हर `run:` block के भीतर का shell।
- [`zizmor`](https://docs.zizmor.sh/) — security audits: `excessive-permissions`, `unpinned-uses`, `template-injection`, `artipacked`।

```yaml
- uses: docker://rhysd/actionlint:1.7.12
  with:
    args: -color
```

- **actionlint को Docker image के रूप में चलाएँ, bare binary के रूप में नहीं।** Image में `shellcheck` और `pyflakes` शामिल हैं। जिस binary के `PATH` पर `shellcheck` नहीं है वह चुपचाप हर shell check छोड़ देता है और exit 0 करता है — तो हरा local run कुछ भी साबित नहीं करता। यही एक विवरण चौदह shell bugs मिलने और एक भी न मिलने के बीच का अंतर है।
- **zizmor के लिए SARIF की जगह annotations चुनें**, जब तक code scanning हर उस जगह सक्षम न हो जहाँ workflow चलता है। SARIF upload forks पर चुपचाप विफल होता है; annotations दोनों जगह स्पष्ट रूप से विफल होते हैं।
- **Severity floor नहीं, confidence floor सेट करें।** `--min-confidence medium` इस आधार पर filter करता है कि tool कितना निश्चित है, इस आधार पर नहीं कि finding कितनी गंभीर है। Floor के नीचे जो आता है उसकी एक बार समीक्षा करें और निर्णय दर्ज करें, बजाय बाद में यह पता चलने के कि floor एक वास्तविक finding छिपा रहा था।
- **Suppressions को एक file तक सीमित रखें, और लिखें कि उन्हें कब हटाया जा सकता है।** एक blanket `ignore` और gate का बिल्कुल न होना — दोनों में कोई अंतर नहीं है।

### 15. Dependency Tree का Audit करें

**Code scanning आपकी dependencies का audit नहीं करता, और PR-scoped dependency review उन dependencies का audit नहीं करता जो आपके पास पहले से हैं।** ये दोनों jobs मिलकर coverage जैसे दिखते हैं और बीच में एक छेद छोड़ देते हैं: CodeQL आपके source का विश्लेषण करता है, जबकि `dependency-review-action` केवल `pull_request` पर चलता है और केवल उन dependencies को देखता है जिन्हें PR _बदलता_ है। किसी ऐसे package के विरुद्ध प्रकाशित advisory जो एक वर्ष से pinned है, दोनों के लिए हमेशा के लिए अदृश्य है, क्योंकि कोई PR उस line को छूता ही नहीं।

```yaml
- run: npm audit --package-lock-only --audit-level=high
```

- **Lockfile का उसी रूप में audit करें जैसे वह commit हुआ है** (`--package-lock-only`)। यह वही रिपोर्ट करता है जो एक consumer को मिलेगा, और इसे किसी ऐसे resolution से हरा नहीं किया जा सकता जो केवल इसी runner पर होता है।
- **Job को schedule पर रखें**, केवल push पर नहीं। Code बदलना बंद हो जाने के बाद प्रकाशित हुई advisory को केवल एक scheduled run ही पकड़ सकता है।
- **Level स्पष्ट रूप से सेट करें।** Default `low` है, जो सबको job की अनदेखी करना सिखा देता है; कोई flag न होना और जानबूझकर `--audit-level=high` लगाना — ये दो अलग विफलताएँ हैं।

### 16. Build करने से पहले सिद्ध करें कि आप Publish कर सकते हैं

**Pull request का काम code को test करना है; default branch पर push का काम release बनाना है।** ये दो अलग काम हैं, और एक गुम credential इनके लिए अलग-अलग अर्थ रखता है। Pull request पर यह एक warning है — forks के पास secrets होते ही नहीं, और code फिर भी test किया जा सकता है। Default branch पर यही उत्तर है: यदि किसी भी नियोजित release के लिए ज़रूरी कोई credential अनुपयोगी है, तो उसके बाद run जो कुछ भी करे वह release नहीं बना सकता, और build में बीता हर मिनट व्यर्थ है।

एक `preflight` job सबसे पहले रखें और हर publishing job को उस पर `needs:` करवाएँ।

```yaml
release-preflight:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    id-token: write # ताकि probe `npm publish` की ज़रूरत पड़ने से पहले ही OIDC की पुष्टि कर ले
  steps:
    - uses: actions/checkout@v7
    - env:
        PREFLIGHT_MODE: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'release' || 'report' }}
      run: node scripts/preflight-credentials.mjs --mode "$PREFLIGHT_MODE"

release:
  needs: [release-preflight]
  if: ${{ !cancelled() && needs.release-preflight.result == 'success' }}
```

- **Login से नहीं, एक write से probe करें।** ghcr.io का token endpoint किसी भी scope के लिए 200 लौटाता है और कुछ भी सत्यापित नहीं करता — push तब 403 से विफल होता है। docker.io अनाम push-scope अनुरोध का उत्तर 200 और केवल-pull `access` claim के साथ देता है। एक blob upload session खोलें (`POST /v2/<repo>/blobs/uploads/`) और उसे `DELETE <Location>` से रद्द करें: एक round trip, कुछ भी संग्रहीत नहीं, और जाँच का यही एकमात्र रूप है जो अनुमान नहीं है।
- **पहली नहीं, हर विफलता रिपोर्ट करें।** Preflight का मूल्य एक ऐसी रिपोर्ट है जो सभी गुम credentials के नाम बताए। Job को रोक देने वाला login step बाकी को छिपा देता है, इसलिए उसे `continue-on-error: true` रखें और निर्णय preflight script को करने दें।
- **केवल writability नहीं, reachability भी जाँचें।** GHCR package पहली push पर private होता है और तब तक private रहता है जब तक कोई क्लिक न करे; ऐसे package के और versions प्रकाशित करना जिसे कोई pull ही नहीं कर सकता, ठीक वही compute है जिसे यह job छोड़ने के लिए है। GitHub package visibility के लिए कोई API नहीं देता (packages REST API केवल GET/DELETE/restore है), इसलिए यह एक manual step है जिसे pipeline केवल पहचान कर नाम दे सकती है।
- **Trusted publishing को प्राथमिकता दें।** समाप्त होने वाला credential एक ऐसा release outage है जो कैलेंडर की तारीख का इंतज़ार कर रहा है। npm (`id-token: write` + `--provenance`) और Docker Hub (`DOCKERHUB_OIDC_CONNECTIONID`, कोई `password:` नहीं) दोनों OIDC का समर्थन करते हैं। कोशिश करने से पहले `ACTIONS_ID_TOKEN_REQUEST_URL` जाँचें — runner उसे तभी inject करता है जब `id-token: write` दिया गया हो, ताकि आधा-अधूरा setup token request के बारे में नहीं, permission के बारे में संदेश के साथ विफल हो।
- **प्रकाशित परिणाम को अनाम रूप से, और अलग से सत्यापित करें।** Release को कभी push पर मत टिकाइए (एक विफल mirror एक अच्छे release को मिटाए नहीं), लेकिन बाद में बिना किसी credential के अवश्य जाँचिए कि जो आपने प्रकाशित किया वह pull हो सकता है या नहीं। Authenticate करने वाली जाँच publisher का दृष्टिकोण मापती है; पाठक को न वह login मिलता है और न ही संदेह का लाभ।
- **अनुमान नहीं, `unknown` रिपोर्ट करें।** Timeout देने वाली या HTTP 429 लौटाने वाली registry ने यह नहीं कहा कि credential टूटा हुआ है, और जिस run में कुछ भी सत्यापित न हो सका वह pass नहीं है। बताइए कि इनमें से क्या हुआ: "0 सत्यापित, 3 unknown" पर कार्रवाई हो सकती है, "कोई विफलता नहीं" पर नहीं।

## Quality Enforcement रणनीति

Templates एक defense-in-depth दृष्टिकोण implement करते हैं:

```
Developer Machine    →    CI/CD Pipeline    →    Release
├── Pre-commit hooks      ├── detect-changes      ├── All checks pass
├── Local tests           ├── version-check       ├── Version bump
└── IDE integration       ├── changeset-check     ├── Changelog update
                          ├── test-compilation    └── Publish package
                          ├── lint (format+ESLint)
                          ├── check-file-line-limits
                          ├── test-suites
                          ├── test-execution
                          ├── validate-docs
                          └── docker-pr-check
```

प्रत्येक layer अलग-अलग issues पकड़ती है, यह सुनिश्चित करते हुए कि कोई समस्याग्रस्त code production तक नहीं पहुँचता।

## शुरू करें

1. **एक template चुनें** ऊपर की table से अपनी भाषा से मेल खाता हुआ
2. **इसे GitHub template के रूप में उपयोग करें** अपना नया repository बनाने के लिए
3. **Secrets configure करें** यदि publishing के लिए आवश्यक हो (OIDC preferred)
4. **Development शुरू करें** सभी सर्वोत्तम प्रथाओं के साथ पूर्व-कॉन्फ़िगर

AI solvers automatically सभी configured checks के साथ respect करेंगे और iterate करेंगे, CI/CD enforcement के बिना repositories की तुलना में उच्च quality output produce करेंगे।

## Automatic CI/CD Remediation

किसी मौजूदा repository के लिए, आपको इन प्रथाओं को हाथ से लागू करने की आवश्यकता नहीं है। `fix` command पूरे flow को automate करता है:

```bash
fix https://github.com/owner/repo --ci-cd
```

यह command:

1. **repository की भाषाओं का पता लगाता है** GitHub Linguist API (`GET /repos/{owner}/{repo}/languages`) का उपयोग करके, प्रति भाषा bytes की संख्या के अनुसार क्रमबद्ध।
2. **मेल खाते CI/CD templates का चयन करता है** ऊपर की table से, इस तरह क्रमबद्ध कि सबसे अधिक उपयोग की जाने वाली भाषा का template पहले आए।
3. **latest default-branch commit का निरीक्षण करता है** और उसके CI/CD runs एकत्र करता है (जब latest commit के पास कोई run न हो तो default branch पर सबसे हाल के runs पर fall back करता है)।
4. **एक remediation issue बनाता है** जो failing runs, पता लगाई गई भाषाओं, अनुशंसित templates, और इस दस्तावेज़ की वापसी link को सूचीबद्ध करता है। यह issue **Bug** type के साथ (और `bug` label के साथ) बनाया जाता है, और इसका title तथा text [मानक remediation template](https://github.com/link-assistant/web-capture/issues/139) से लिया जाता है।
5. **issue को `/solve --development-log --deep-analysis --auto-merge` को सौंपता है**, जो तब तक iterate करता है जब तक fixes merge न हो जाएँ। हर वह option जिसे `fix` स्वयं उपभोग नहीं करता (उदाहरण के लिए `--tool`, `--model`, `--think`) `/solve` को forward किया जाता है।

### issue Bug type क्यों है, और उसमें से क्या छोड़ा जाता है

`--development-log` template के पुराने case-study-folder निर्देश को प्रतिस्थापित करता है और artifacts को `./dev/log/issues/{issue-id}/pulls/{pull-id}` में एकत्र करता है। `/fix` पुराने paragraph को कभी उत्पन्न नहीं करता, चाहे `--no-solve` या options का आंशिक set उपयोग हो। `--deep-analysis` timeline, root-cause, debug-output और upstream-reporting guidance प्रदान करता है, इसलिए `fix` matching paragraphs को conditionally छोड़ता है ताकि वे दो बार न पहुँचें।

यह omission केवल इसलिए सुरक्षित है क्योंकि `/solve` root-cause संबंधी शब्दावली **केवल Bug type के issues के लिए** उत्सर्जित करता है — यही कारण है कि `fix` issue को Bug के रूप में बनाता है। issue types संगठन स्तर पर और labels repository स्तर पर configure होते हैं, इसलिए यदि target repository इनमें से किसी को स्वीकार नहीं करता, तब भी issue उनके बिना बना दिया जाता है।

किसी भी option combination से पुराना paragraph वापस नहीं आता; `--development-log` ही supported collection workflow है। बाकी conditional omissions को `--deep-analysis` नियंत्रित करता है।

### Language → Template Mapping

command पता लगाई गई भाषाओं को templates से इस प्रकार map करता है (JavaScript और TypeScript एक ही template साझा करते हैं):

| Detected Language(s)  | Template                                                         |
| --------------------- | ---------------------------------------------------------------- |
| JavaScript/TypeScript | `link-foundation/js-ai-driven-development-pipeline-template`     |
| Rust                  | `link-foundation/rust-ai-driven-development-pipeline-template`   |
| Python                | `link-foundation/python-ai-driven-development-pipeline-template` |
| Go                    | `link-foundation/go-ai-driven-development-pipeline-template`     |
| C#                    | `link-foundation/csharp-ai-driven-development-pipeline-template` |
| Java                  | `link-foundation/java-ai-driven-development-pipeline-template`   |
| PHP                   | `link-foundation/php-ai-driven-development-pipeline-template`    |

जिन भाषाओं के लिए कोई समर्पित template नहीं है (उदाहरण के लिए Shell या Dockerfile) उन्हें जानकारी के लिए issue में सूचीबद्ध किया जाता है, और निकटतम मेल खाते template की अनुशंसा की जाती है।

issue को बनाए बिना उसका पूर्वावलोकन करने के लिए `--dry-run` का उपयोग करें, और `/solve` शुरू किए बिना issue बनाने के लिए `--no-solve` का उपयोग करें:

```bash
fix owner/repo --ci-cd --dry-run
fix owner/repo --ci-cd --no-solve
```

## संदर्भ

- [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles)
- [Contributing Guidelines](./CONTRIBUTING.md)
- [Best Practices](./BEST-PRACTICES.md)
