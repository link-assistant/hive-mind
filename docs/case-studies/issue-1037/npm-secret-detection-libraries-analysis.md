# NPM Secret Detection Libraries Analysis

**Date:** January 2026
**Issue:** [#1037](https://github.com/link-assistant/hive-mind/issues/1037) - Token Sanitization
**Purpose:** Comprehensive analysis of open-source NPM libraries for detecting and sanitizing API tokens and secrets

---

## Executive Summary

This document analyzes the available open-source NPM libraries for secret/token detection. After evaluating several options, **secretlint** emerges as the most suitable choice for JavaScript/TypeScript projects requiring comprehensive token pattern matching, particularly for AI provider tokens (OpenAI, Anthropic, Google) and other service credentials.

---

## Libraries Analyzed

### 1. Secretlint (Recommended)

**Repository:** [github.com/secretlint/secretlint](https://github.com/secretlint/secretlint)
**NPM Package:** [secretlint](https://www.npmjs.com/package/secretlint)
**License:** MIT
**GitHub Stars:** ~1,275
**Weekly Downloads:** ~10,000+ (across all packages)
**Last Updated:** Actively maintained (updates within last week)

#### Key Features

- **Pluggable Architecture**: Modular rule system with individual packages for each provider
- **Opt-in Approach**: Reduces false positives through explicit configuration
- **Secret Masking**: Automatically masks secrets in output (useful for CI logs and AI agent tools)
- **Multiple Installation Methods**: npm, Docker, single-executable binary
- **Pre-commit Integration**: Works with Husky, lint-staged, and pre-commit framework
- **CI/CD Ready**: SARIF output for GitHub Actions integration

#### Available Rule Packages (26 total)

| Category            | Rules                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI/ML Providers** | `@secretlint/secretlint-rule-openai`, `@secretlint/secretlint-rule-anthropic`                                                                            |
| **Cloud Providers** | `@secretlint/secretlint-rule-aws`, `@secretlint/secretlint-rule-gcp`, `@secretlint/secretlint-rule-azure`                                                |
| **Developer Tools** | `@secretlint/secretlint-rule-github`, `@secretlint/secretlint-rule-npm`                                                                                  |
| **SaaS Services**   | `@secretlint/secretlint-rule-slack`, `@secretlint/secretlint-rule-sendgrid`, `@secretlint/secretlint-rule-shopify`, `@secretlint/secretlint-rule-linear` |
| **Security**        | `@secretlint/secretlint-rule-privatekey`, `@secretlint/secretlint-rule-secp256k1-privatekey`, `@secretlint/secretlint-rule-1password`                    |
| **Infrastructure**  | `@secretlint/secretlint-rule-basicauth`, `@secretlint/secretlint-rule-database-connection-string`, `@secretlint/secretlint-rule-no-k8s-kind-secret`      |
| **Utilities**       | `@secretlint/secretlint-rule-pattern` (custom regex patterns), `@secretlint/secretlint-rule-no-dotenv`, `@secretlint/secretlint-rule-no-homedir`         |
| **Presets**         | `@secretlint/secretlint-rule-preset-recommend` (bundled recommended rules)                                                                               |

#### Token Patterns Detected

**OpenAI Tokens:**

- `sk-proj-*` (project keys)
- `sk-svcacct-*` (service account keys)
- `sk-*` with T3BlbkFJ signature (legacy keys)

**Anthropic Tokens:**

- `sk-ant-api03-*`
- `sk-ant-api01-*`
- `sk-ant-*`

**AWS Credentials:**

- Access Key IDs: `AKIA*`, `ASIA*`, `AGPA*`, `AROA*`, `AIPA*`, `ANPA*`, `ANVA*`
- Secret Access Keys (high-entropy detection)

**Other Patterns:**

- GitHub tokens (`ghp_*`, `gho_*`, `ghu_*`, `ghs_*`, `ghr_*`)
- Slack tokens (`xoxb-*`, `xoxp-*`, etc.)
- SendGrid API keys (`SG.*.*`)
- Private keys (RSA, EC, PGP)
- Database connection strings

#### Installation

```bash
# Install secretlint with recommended preset
npm install secretlint @secretlint/secretlint-rule-preset-recommend --save-dev

# Initialize configuration
npx secretlint --init

# Run scan
npx secretlint "**/*"
```

#### Configuration Example

```json
{
  "rules": [
    {
      "id": "@secretlint/secretlint-rule-preset-recommend"
    },
    {
      "id": "@secretlint/secretlint-rule-pattern",
      "options": {
        "patterns": [
          {
            "name": "Custom API Key",
            "pattern": "/my-api-key-[a-zA-Z0-9]+/i"
          }
        ]
      }
    }
  ]
}
```

#### Pros

- Native JavaScript implementation (no Python dependency)
- Comprehensive AI provider support (OpenAI, Anthropic built-in)
- Active maintenance with regular updates
- Modular design allows selecting only needed rules
- Built-in secret masking for safe logging
- Excellent documentation

#### Cons

- Requires separate installation of each rule package (or use preset)
- Smaller community compared to Python alternatives like TruffleHog

---

### 2. @bytehide/secrets-scanner

**Repository:** Private (ByteHide)
**NPM Package:** [@bytehide/secrets-scanner](https://www.npmjs.com/package/@bytehide/secrets-scanner)
**License:** Commercial with free tier
**Last Updated:** Active

#### Key Features

- **Multi-pronged Detection**: Regex rules, entropy analysis, context-based scanning, provider-specific plugins
- **AI-powered Detection**: Advanced pattern recognition (Enterprise feature)
- **Build Artifact Scanning**: Scans post-compilation artifacts
- **Built-in Secrets Manager**: Integrated secret management platform
- **Zero-knowledge Privacy**: All scanning performed locally

#### Supported Languages/Frameworks

- JavaScript, TypeScript, JSX, TSX, JSON
- React, Vue, Angular, Next.js, Nuxt.js, Express
- Webpack, Vite, Rollup, Parcel

#### Detection Output Example

```json
{
  "line": 45,
  "file": "src/config.js",
  "secret": "sk_live_***",
  "rule": "Stripe Secret Key",
  "confidence": "high",
  "method": "pattern"
}
```

#### Pros

- Comprehensive detection with multiple methods
- Modern framework support
- Zero-knowledge local scanning

#### Cons

- Commercial product (AI features require Enterprise license)
- Less transparent pattern definitions
- Vendor lock-in risk

---

### 3. secure-scan-js

**NPM Package:** [secure-scan-js](https://www.npmjs.com/package/secure-scan-js)
**License:** MIT
**Version:** 1.0.27
**Last Updated:** ~4 months ago

#### Key Features

- JavaScript implementation of Yelp's detect-secrets
- Uses WebAssembly technology
- No Python dependency required
- Compatible API with original detect-secrets

#### Pros

- Native JavaScript (no Python needed)
- Memory efficient
- False positive detection

#### Cons

- Less active maintenance
- Fewer built-in patterns than secretlint
- No dedicated AI provider rules

---

### 4. detect-secrets (npm wrapper)

**Repository:** [github.com/lirantal/detect-secrets](https://github.com/lirantal/detect-secrets)
**NPM Package:** [detect-secrets](https://www.npmjs.com/package/detect-secrets)
**License:** Apache-2.0
**Last Updated:** March 2020 (outdated)

#### Key Features

- Node.js wrapper for Yelp's Python detect-secrets
- Falls back to Docker if Python not found
- Pre-commit hook integration

#### Pros

- Leverages proven Yelp detect-secrets patterns

#### Cons

- **Outdated** (last update 2020)
- Requires Python or Docker
- Not recommended for new projects

---

### 5. eslint-plugin-no-secrets

**Repository:** [github.com/nickdeis/eslint-plugin-no-secrets](https://github.com/nickdeis/eslint-plugin-no-secrets)
**NPM Package:** [eslint-plugin-no-secrets](https://www.npmjs.com/package/eslint-plugin-no-secrets)
**Weekly Downloads:** ~61,000
**License:** ISC

#### Key Features

- ESLint integration
- Entropy-based detection (like early TruffleHog)
- AST-based analysis for JavaScript files
- Two rules: `no-secrets` and `no-pattern-match`

#### Detection Methods

1. **Entropy Analysis**: Identifies high-entropy strings that look like secrets
2. **Pattern Matching**: Regex-based detection (AWS keys, etc.)
3. **AST Inspection**: Checks string templates, comments, literals

#### Configuration Example

```json
{
  "plugins": ["no-secrets"],
  "rules": {
    "no-secrets/no-secrets": ["error", { "tolerance": 3.2 }],
    "no-secrets/no-pattern-match": "error"
  }
}
```

#### Pros

- Integrates with existing ESLint workflow
- Well-maintained with regular updates
- Good for JS/TS focused projects

#### Cons

- Limited to ESLint ecosystem
- Fewer built-in patterns than secretlint
- No dedicated AI provider patterns

---

### 6. Gitleaks (via @ziul285/gitleaks)

**Original Repository:** [github.com/gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)
**NPM Wrapper:** [@ziul285/gitleaks](https://www.npmjs.com/package/@ziul285/gitleaks)
**Original Tool Stars:** 19,000+
**License:** MIT

#### Key Features

- 160+ secret type detectors
- Git history scanning
- Three modes: git, dir, stdin
- JSON, SARIF, CSV output

#### Pros

- Extensive pattern library (800+ detectors with verification)
- Active development and large community
- Deep git history scanning

#### Cons

- Original tool is Go-based (npm package is community wrapper)
- npm wrapper may lag behind main development
- Overkill for runtime sanitization

---

## Comparison Matrix

| Feature                | secretlint | @bytehide  | secure-scan-js | eslint-plugin-no-secrets | gitleaks     |
| ---------------------- | ---------- | ---------- | -------------- | ------------------------ | ------------ |
| **Native JavaScript**  | Yes        | Yes        | Yes            | Yes                      | No (wrapper) |
| **OpenAI Patterns**    | Yes        | Yes        | Limited        | No                       | Yes          |
| **Anthropic Patterns** | Yes        | Yes        | Limited        | No                       | Yes          |
| **AWS Patterns**       | Yes        | Yes        | Yes            | Yes                      | Yes          |
| **GitHub Patterns**    | Yes        | Yes        | Yes            | Limited                  | Yes          |
| **Custom Patterns**    | Yes        | Yes        | Yes            | Yes                      | Yes          |
| **Active Maintenance** | Yes        | Yes        | Moderate       | Yes                      | Yes          |
| **License**            | MIT        | Commercial | MIT            | ISC                      | MIT          |
| **ESLint Integration** | No         | No         | No             | Native                   | No           |
| **Pre-commit Hooks**   | Yes        | Yes        | Yes            | Via ESLint               | Yes          |
| **CI/CD Integration**  | SARIF      | Yes        | Basic          | Via ESLint               | SARIF        |
| **Secret Masking**     | Yes        | Yes        | No             | No                       | No           |
| **Runtime API**        | Yes        | Yes        | Yes            | No                       | No           |

---

## Recommendation

### Primary Recommendation: Secretlint

For this project's needs (sanitizing AI provider tokens in logs/output), **secretlint** is the recommended choice because:

1. **Native AI Provider Support**: Built-in rules for OpenAI and Anthropic tokens
2. **Active Development**: Regular updates with latest token patterns
3. **Secret Masking**: Critical for sanitizing tokens in logs
4. **Flexible Integration**: Can be used as library or CLI
5. **No External Dependencies**: Pure JavaScript implementation
6. **MIT License**: Permissive open-source license

### Alternative: Custom Implementation

Given the project already has a custom token sanitization module (`src/token-sanitization.lib.mjs`), consider:

1. **Hybrid Approach**: Use secretlint's patterns as reference for custom regex
2. **Runtime Performance**: Custom implementation may be faster for runtime sanitization
3. **Minimal Dependencies**: Avoid adding large dependencies for focused use case

### Integration Path

If adopting secretlint:

```bash
npm install secretlint @secretlint/secretlint-rule-preset-recommend --save-dev
```

For programmatic use (extracting patterns):

- Study patterns from: `@secretlint/secretlint-rule-openai`
- Study patterns from: `@secretlint/secretlint-rule-anthropic`
- Study patterns from: `@secretlint/secretlint-rule-aws`

---

## References

- [Secretlint GitHub Repository](https://github.com/secretlint/secretlint)
- [Secretlint NPM Package](https://www.npmjs.com/package/secretlint)
- [@bytehide/secrets-scanner NPM](https://www.npmjs.com/package/@bytehide/secrets-scanner)
- [eslint-plugin-no-secrets GitHub](https://github.com/nickdeis/eslint-plugin-no-secrets)
- [Gitleaks GitHub Repository](https://github.com/gitleaks/gitleaks)
- [TruffleHog GitHub Repository](https://github.com/trufflesecurity/trufflehog)
- [Yelp detect-secrets Blog Post](https://engineeringblog.yelp.com/2018/06/yelps-secret-detector.html)
- [Best Secret Scanning Tools in 2025](https://www.aikido.dev/blog/top-secret-scanning-tools)

---

_Document generated for Issue #1037 token sanitization research_
