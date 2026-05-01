# AI-संचालित विकास के लिए सर्वोत्तम प्रथाएं (languages: [en](BEST-PRACTICES.md) • [zh](BEST-PRACTICES.zh.md) • hi • [ru](BEST-PRACTICES.ru.md))

यह दस्तावेज़ Hive Mind और AI-संचालित विकास कार्यप्रवाह के साथ प्रभावी ढंग से काम करने के लिए सामान्य सर्वोत्तम प्रथाओं का वर्णन करता है। यह सार्वभौमिक prompting रणनीतियों, issue लेखन दिशानिर्देशों, आर्किटेक्चर सिद्धांतों, और CI/CD मानकों के लिंक को कवर करता है।

## विषय सूची

- [सर्वोत्तम प्रथाएं क्यों मायने रखती हैं](#सर्वोत्तम-प्रथाएं-क्यों-मायने-रखती-हैं)
- [सार्वभौमिक Prompts](#सार्वभौमिक-prompts)
- [अच्छे Issues लिखना](#अच्छे-issues-लिखना)
- [आर्किटेक्चर सुधार](#आर्किटेक्चर-सुधार)
- [CI/CD सर्वोत्तम प्रथाएं](#cicd-सर्वोत्तम-प्रथाएं)
- [Subagents का उपयोग करना](#subagents-का-उपयोग-करना)
- [संदर्भ](#संदर्भ)

## सर्वोत्तम प्रथाएं क्यों मायने रखती हैं

Hive Mind की गुणवत्ता काफी हद तक निर्भर करती है:

1. **स्पष्ट issue आवश्यकताएं** — अस्पष्ट issues अस्पष्ट समाधान उत्पन्न करती हैं
2. **मजबूत CI/CD pipelines** — AI solvers तब तक पुनरावृत्त होते हैं जब तक सभी checks pass नहीं हो जाते, गुणवत्ता की गारंटी देते हैं
3. **अच्छा prompting** — सार्वभौमिक prompts AI को गहरा विश्लेषण करने और सामान्य गलतियों से बचने में मदद करते हैं
4. **आर्किटेक्चर अनुशासन** — सुसंगत कोड संरचना AI के लिए navigate और extend करना आसान है

इनमें से प्रत्येक परत compound होती है: अच्छी आवश्यकताएं + मजबूत CI/CD + अच्छे prompts = लगातार उत्कृष्ट स्वचालित समाधान।

## सार्वभौमिक Prompts

निम्नलिखित prompts को किसी भी GitHub issue या pull request में comment के रूप में जोड़ा जा सकता है ताकि AI solver के व्यवहार को guide किया जा सके।

### गहरे विश्लेषण Bug Prompt

इसका उपयोग तब करें जब किसी bug को fix का प्रयास करने से पहले गहन जांच की आवश्यकता हो:

```
Please perform a deep case study for this issue:
1. Download all relevant logs, error output, and reproduction data to ./docs/case-studies/issue-{id}/
2. Search online for similar issues, known root causes, and community solutions
3. Reconstruct the full timeline: when did this start, what changed, what is the sequence of events that causes the bug?
4. Identify the true root cause (not just the symptom)
5. Propose multiple solution approaches with trade-offs
6. Implement the best solution with tests
7. Verify CI/CD checks pass before finalizing
```

### गहरे विश्लेषण Feature Prompt

इसका उपयोग तब करें जब किसी feature request को implementation से पहले शोध और design की आवश्यकता हो:

```
Please perform a deep analysis for this feature request:
1. Collect all relevant context and examples to ./docs/case-studies/issue-{id}/
2. Search online for how similar features are implemented in comparable tools
3. Analyze trade-offs: performance, maintainability, backward compatibility
4. Propose a detailed implementation plan with alternative approaches
5. Implement the chosen approach with tests
6. Update documentation to reflect the new feature
7. Verify all CI/CD checks pass before finalizing
```

### सार्वभौमिक सत्यापन Prompt

किसी भी समाधान को अंतिम रूप देने से पहले यह comment जोड़ें ताकि कुछ भी छूट न जाए:

```
Before marking this complete, please verify:
1. All requirements from the original issue are addressed
2. All discussion points from PR/issue comments are resolved
3. All CI/CD checks are passing (no lint errors, all tests green)
4. No previously working features have been broken
5. Code follows the repository's existing style and conventions
6. Documentation is updated if behavior changed
7. No debug code, temporary hacks, or TODOs remain
8. The changeset (if required) is present and accurate
```

### Plan Mode Prompt

इसका उपयोग तब करें जब आप चाहते हैं कि AI कोई कोड लिखने से पहले एक plan प्रस्तावित करे:

```
Please enter plan mode for this issue:
1. Collect all relevant data to ./docs/case-studies/issue-{id}/
2. Read all related source files, tests, and documentation
3. Search online if external knowledge is needed
4. Propose a detailed step-by-step implementation plan
5. List all files that will be created or modified
6. Identify risks and edge cases
7. Wait for approval before writing any code
```

### Maximum Power Prompt

जटिल issues के लिए इसका उपयोग करें जहां पूर्ण AI क्षमता की आवश्यकता हो:

```
Solve this issue using maximum thoroughness:
- Use --model opus --think max for deep reasoning
- Download and analyze all relevant logs
- Do online research for similar problems and solutions
- Write comprehensive tests covering edge cases
- Add detailed tracing/logging that remains in code but is off by default
- Ensure all CI/CD checks pass
- Leave no stone unturned
```

## अच्छे Issues लिखना

अच्छी issue आवश्यकताएं गुणवत्तापूर्ण AI समाधानों की नींव हैं। उदाहरणों के लिए इस repository में बंद issues और merged PRs का अध्ययन करें।

### Issue लेखन चेकलिस्ट

- [ ] **स्पष्ट समस्या विवरण** — क्या टूटा हुआ या गायब है? अपेक्षित बनाम वास्तविक व्यवहार क्या है?
- [ ] **पुनरुत्पादन चरण** — समस्या को विश्वसनीय रूप से कैसे पुनरुत्पादित किया जा सकता है?
- [ ] **संदर्भ** — कौन सी फाइलें, functions, या components शामिल हैं? उनसे link करें।
- [ ] **Acceptance criteria** — कौन सी विशिष्ट शर्तें "पूर्ण" को परिभाषित करती हैं? उन्हें स्पष्ट रूप से सूचीबद्ध करें।
- [ ] **उदाहरण** — साक्ष्य के रूप में code snippets, error messages, या screenshots शामिल करें।
- [ ] **बाधाएं** — क्या ऐसी चीजें हैं जो समाधान नहीं करना चाहिए (जैसे, X को नहीं तोड़ना चाहिए, dependency नहीं जोड़नी चाहिए)?
- [ ] **प्राथमिकता** — यह कितना जरूरी है? अनफिक्स छोड़ने पर क्या impact होगा?

### इस Repository के Issue Requirement Patterns

इस repository में सफलतापूर्वक हल किए गए issues के आधार पर:

**Bugs के लिए:**

```
## Problem
[गलत व्यवहार का एक वाक्य विवरण]

## Steps to Reproduce
1. [सटीक command या action]
2. [क्या होता है]
3. [इसके बजाय क्या होना चाहिए]

## Root Cause Hypothesis
[वैकल्पिक: आपका सबसे अच्छा अनुमान कि ऐसा क्यों होता है]

## Acceptance Criteria
- [ ] [विशिष्ट मापनीय शर्त 1]
- [ ] [विशिष्ट मापनीय शर्त 2]
- [ ] सभी CI/CD checks pass हों
```

**Features के लिए:**

```
## Goal
[नई क्षमता का एक वाक्य विवरण]

## Motivation
[इसकी जरूरत क्यों है? यह कौन सी समस्या हल करता है?]

## Proposed Implementation
[वैकल्पिक: इसे implement करने का आपका सुझाव]

## Acceptance Criteria
- [ ] [Feature scenario A में काम करता है]
- [ ] [Feature scenario B में काम करता है]
- [ ] Tests नए व्यवहार को cover करते हैं
- [ ] Documentation अपडेट है
- [ ] सभी CI/CD checks pass हों
```

## आर्किटेक्चर सुधार

AI का उपयोग करके codebase की architecture में सुधार करने के लिए, Code Architecture Principles का संदर्भ देने वाले इस prompt का उपयोग करें:

```
Please analyze this codebase against the architecture principles at:
https://raw.githubusercontent.com/link-foundation/code-architecture-principles/refs/heads/main/README.md

For each principle that is currently violated or could be better applied:
1. Identify the specific location (file:line) where the violation occurs
2. Explain why it is a violation and what the impact is
3. Propose a concrete refactoring with a before/after code example
4. Prioritize by impact: high/medium/low

Focus especially on:
- File size limits (1000-1500 lines max)
- Single Responsibility principle
- Separation of concerns
- Testability
- Explicit interfaces and minimal coupling
```

### मुख्य Architecture Principles सारांश

रखरखाव योग्य कोड लिखने पर गहरे मार्गदर्शन के लिए, [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles) देखें, जो कवर करता है:

**सार्वभौमिक सिद्धांत:**

- **Modularity**: सिस्टम को छोटे, परीक्षण योग्य भागों में विभाजित करें
- **चिंताओं का पृथक्करण**: उच्च cohesion, कम coupling
- **Abstraction**: stable interfaces के पीछे implementation details छिपाएं
- **Immutability**: mutation के बजाय नए मान बनाना पसंद करें
- **Fail fast**: सिस्टम सीमाओं पर input को validate करें

**मुख्य सिफारिशें:**

1. APIs डिज़ाइन करें जो सही तरीके से उपयोग करना स्पष्ट हो और गलत तरीके से उपयोग करना कठिन
2. extensibility सक्षम करने के लिए functionality को expose करें बजाय internals को छिपाने के
3. विचारशील data modeling के माध्यम से invalid states को असंभव बनाएं
4. side effects को सिस्टम edges पर relocate करें; core logic को pure रखें
5. valid data shapes को model करने के लिए type systems का उपयोग करें
6. छोटे, focused functions लिखें जो एक काम अच्छी तरह से करती हैं
7. inheritance और जटिलता के बजाय composition को प्राथमिकता दें

## CI/CD सर्वोत्तम प्रथाएं

CI/CD pipelines AI-संचालित विकास गुणवत्ता की रीढ़ हैं। जब checks enforce होते हैं:

- AI solvers **तब तक पुनरावृत्त होने के लिए बाध्य होते हैं** जब तक सभी tests pass नहीं हो जाते
- कोड गुणवत्ता मानव या AI authorship की परवाह किए बिना **गारंटीड** है
- Issues production तक पहुंचने से **पहले ही** पकड़ी जाती हैं

पूरी guide के लिए **[CI-CD-BEST-PRACTICES.md](./CI-CD-BEST-PRACTICES.md)** देखें, जिसमें शामिल हैं:

- केवल प्रासंगिक फ़ाइल परिवर्तनों पर checks चलाना (CI लागत बचाएं)
- फ़ाइल आकार सीमाएं और fast-fail job ordering
- स्वचालित formatting, linting, और static analysis
- merge conflicts के बिना Changeset-based versioning
- वास्तविक merged result को validate करने के लिए Fresh merge simulation
- Long-lived secrets के बिना OIDC trusted publishing

JavaScript, Rust, Python, Go, C#, और Java के लिए उपयोग के लिए तैयार templates उपलब्ध हैं।

## Subagents का उपयोग करना

Hive Mind समानांतर में काम करने वाले कई AI agents को coordinate कर सकता है। Subagents का उपयोग करें:

### Subagents कब उपयोग करें

- **स्वतंत्र parallel research** — एक agent logs खोजता है जबकि दूसरा source code पढ़ता है
- **मुख्य context की रक्षा करना** — बड़े file reads या लंबी खोजों को subagents पर offload करें
- **विशेष tasks** — दस्तावेज़ीकरण के लिए एक dedicated agent, tests के लिए दूसरा
- **Cross-validation** — कई agents स्वतंत्र रूप से समाधान प्रस्तावित करें, फिर तुलना करें

### Subagent Patterns

**Parallel research:**

```
Launch subagents concurrently for:
- Agent 1: Read all source files related to [feature area]
- Agent 2: Search for recent issues and PRs related to this problem
- Agent 3: Read all test files to understand expected behavior
Then synthesize findings before implementing.
```

**Staged work:**

```
Stage 1 (research subagent): Collect and analyze all relevant data
Stage 2 (plan subagent): Design the implementation approach
Stage 3 (implementation): Write and test the solution
Stage 4 (validation subagent): Run all checks and verify requirements
```

**Checklist iteration:**

```
Maintain a checklist of all requirements from the issue.
After each step, check off completed items.
Iterate until the checklist is fully complete and all CI/CD checks pass.
Never mark a task done until it is verified working.
```

## संदर्भ

- [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles)
- [CI/CD Best Practices](./CI-CD-BEST-PRACTICES.md)
- [Contributing Guidelines](./CONTRIBUTING.hi.md)
- [Configuration Options](./CONFIGURATION.md)
