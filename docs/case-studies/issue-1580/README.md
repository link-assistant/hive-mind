# Case Study: Issue #1580 — Add Translation to Chinese, Hindi, and Russian

## Issue Summary

**Issue**: [#1580](https://github.com/link-assistant/hive-mind/issues/1580)
**Type**: Documentation / Enhancement
**Labels**: documentation, enhancement

The issue requests that all documentation in the hive-mind repository be translated into three languages: Chinese (zh), Hindi (hi), and Russian (ru). The translation must follow the file naming convention and language switcher pattern established in the [link-foundation/links-notation](https://github.com/link-foundation/links-notation) repository.

## Requirements

1. **Translate all markdown documentation** to Chinese, Hindi, and Russian
2. **File naming convention**: `FILENAME.{lang}.md` (e.g., `README.zh.md`, `README.hi.md`, `README.ru.md`)
3. **Language switcher in titles**: Each markdown document must include a language switcher in the title line, following the pattern from links-notation:
   - English version: `# Title (languages: en • [zh](FILENAME.zh.md) • [hi](FILENAME.hi.md) • [ru](FILENAME.ru.md))`
   - Chinese version: `# 标题 (languages: [en](FILENAME.md) • zh • [hi](FILENAME.hi.md) • [ru](FILENAME.ru.md))`
   - Hindi version: `# शीर्षक (languages: [en](FILENAME.md) • [zh](FILENAME.zh.md) • hi • [ru](FILENAME.ru.md))`
   - Russian version: `# Заголовок (languages: [en](FILENAME.md) • [zh](FILENAME.zh.md) • [hi](FILENAME.hi.md) • ru)`

## Scope of Work

### Files Requiring Translation

**Root level (1 file):**
- `README.md` (876 lines) — Main project documentation

**Docs directory (19 files):**
- `docs/BEST-PRACTICES.md` (273 lines)
- `docs/BRANCH_PROTECTION_POLICY.md` (233 lines)
- `docs/CI-CD-BEST-PRACTICES.md` (327 lines)
- `docs/COMPARISON.md` (297 lines)
- `docs/CONFIGURATION.md` (566 lines)
- `docs/CONTRIBUTING.md` (126 lines)
- `docs/DOCKER.md` (293 lines)
- `docs/FEATURES.md` (302 lines)
- `docs/FREE_MODELS.md` (326 lines)
- `docs/HELM.md` (541 lines)
- `docs/OPENROUTER.md` (251 lines)
- `docs/RATE_LIMIT_ANALYSIS.md` (172 lines)
- `docs/SENTRY_TO_GITHUB_ISSUES.md` (737 lines)
- `docs/UBUNTU-SERVER.md` (131 lines)
- `docs/codex-limitations.md` (140 lines)
- `docs/flow.md` (473 lines)
- `docs/issue-94-claude-command-kills-solution.md` (76 lines)
- `docs/sentry-github-universal-integration.md` (855 lines)
- `docs/sentry-to-github-issues.md` (620 lines)

**Total**: 20 files × 3 languages = 60 new translated files + 20 files updated with language switchers = **80 file operations**

**Total lines**: 7,615 lines × 3 languages = ~22,845 lines of translated content

## Reference Implementation

The [link-foundation/links-notation](https://github.com/link-foundation/links-notation) repository serves as the reference for:

1. **File naming**: `README.ru.md` pattern (language code before `.md` extension)
2. **Language switcher format**:
   - English: `(languages: en • [ru](README.ru.md))`
   - Russian: `(languages: [en](README.md) • ru)`
3. **Current language** is shown as plain text (not a link), other languages are markdown links

## Solution Approach

1. Add language switchers to all existing English markdown files
2. Create translated versions for each language (zh, hi, ru)
3. Ensure all internal cross-references between docs are updated to point to the correct language version
4. Maintain code blocks, images, and badges unchanged (only translate prose content)
5. Commit incrementally to preserve progress

## Translation Guidelines

- **Code blocks**: Keep as-is (do not translate code, commands, or CLI output)
- **Badges/shields**: Keep as-is
- **URLs**: Keep as-is, except for internal doc links which should point to translated versions
- **Technical terms**: Use commonly accepted translations or keep original with transliteration
- **Mermaid diagrams**: Translate participant labels and notes
- **Tables**: Translate header and content cells, keep structure
