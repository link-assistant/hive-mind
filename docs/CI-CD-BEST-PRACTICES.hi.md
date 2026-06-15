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

**एक साथ चल रहे कई workflow runs को conflict करने से रोकें:**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  # Cancel older runs on main to always release the latest version
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

Job conditions में `always()` के बजाय `!cancelled()` उपयोग करें ताकि cancellation job graph के माध्यम से सही तरीके से propagate हो।

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
4. **एक remediation issue बनाता है** जो failing runs, पता लगाई गई भाषाओं, अनुशंसित templates, और इस दस्तावेज़ की वापसी link को सूचीबद्ध करता है।
5. **issue को `/solve --auto-merge` को सौंपता है**, जो तब तक iterate करता है जब तक fixes merge न हो जाएँ। हर वह option जिसे `fix` स्वयं उपभोग नहीं करता (उदाहरण के लिए `--tool`, `--model`, `--think`) `/solve` को forward किया जाता है।

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
