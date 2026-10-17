"""Insert the issue #3413 Dependabot merge step into DEPENDENCY-UPDATE-BEST-PRACTICES.{,ru,zh,hi}.md."""
import re, sys

STEP = {
    'en': "1. **Merges every open Dependabot pull request without waiting for CI/CD** ([issue #3413](https://github.com/link-assistant/hive-mind/issues/3413)), oldest first, before anything else is inspected — so the issue describes the repository after Dependabot's updates have landed and the solver does not redo them by hand.",
    'ru': "1. **Вливает все открытые pull request'ы Dependabot, не дожидаясь CI/CD** ([issue #3413](https://github.com/link-assistant/hive-mind/issues/3413)), начиная с самых старых и до любого другого анализа — поэтому задача описывает репозиторий уже после обновлений Dependabot, и решатель не повторяет их вручную.",
    'zh': "1. **不等待 CI/CD，合并所有打开的 Dependabot pull request**（[issue #3413](https://github.com/link-assistant/hive-mind/issues/3413)），从最早的开始，并且先于任何其他检查——这样 issue 描述的是 Dependabot 更新落地之后的仓库，求解器也不必手动重做这些更新。",
    'hi': "1. **CI/CD की प्रतीक्षा किए बिना हर खुला Dependabot pull request merge करता है** ([issue #3413](https://github.com/link-assistant/hive-mind/issues/3413)), सबसे पुराने से शुरू करके और किसी भी अन्य जाँच से पहले — ताकि issue Dependabot के अपडेट लागू होने के बाद की repository का वर्णन करे और solver उन्हें हाथ से दोबारा न करे।",
}

PARAGRAPH = {
    'en': """The issue starts with a **Dependabot pull requests merged before this issue was created** section: every merged pull request with the checks that were not passing at merge time, and a bold instruction to fix every build, test, lint, security and deprecation error those merges introduced until the default branch CI/CD is green again — without reverting the updates. Merging uses the first merge method the repository allows (merge commit, squash, rebase), pins `--match-head-commit` to the head that was inspected, and retries once with `--admin` when only branch rules (required checks, required reviews, an out-of-date branch) block it. Pull requests that still cannot be merged — conflicts, drafts, rulesets without bypass — stay open and are listed in the issue so their updates are applied in the solver's pull request; Dependabot closes them by itself once the update has landed. `--dry-run` only lists what would be merged, and `--no-merge-dependabot-prs` turns the step off. `/task --update-all-dependencies` follows the same rules:

```bash
fix owner/repo --update-all-dependencies --no-merge-dependabot-prs
```
""",
    'ru': """Задача начинается с раздела **Dependabot pull requests merged before this issue was created**: каждый влитый pull request с проверками, которые не проходили в момент слияния, и выделенное требование исправить все ошибки сборки, тестов, линтера, безопасности и устаревших API, внесённые этими слияниями, пока CI/CD основной ветки снова не станет зелёным, — не откатывая обновления. Слияние использует первый разрешённый репозиторием способ (merge commit, squash, rebase), закрепляет `--match-head-commit` за проверенным коммитом и один раз повторяется с `--admin`, если мешают только правила ветки (обязательные проверки, обязательные ревью, устаревшая ветка). Pull request'ы, которые всё равно нельзя влить (конфликты, черновики, rulesets без обхода), остаются открытыми и перечисляются в задаче, чтобы их обновления были применены в pull request решателя; Dependabot сам закроет их, когда обновление окажется в ветке. `--dry-run` только перечисляет то, что было бы влито, а `--no-merge-dependabot-prs` отключает этот шаг. `/task --update-all-dependencies` работает по тем же правилам:

```bash
fix owner/repo --update-all-dependencies --no-merge-dependabot-prs
```
""",
    'zh': """issue 以 **Dependabot pull requests merged before this issue was created** 一节开头：列出每个已合并的 pull request 及其合并时未通过的检查，并以粗体要求修复这些合并引入的所有构建、测试、lint、安全和弃用错误，直到默认分支的 CI/CD 重新变绿——且不得回退这些更新。合并使用仓库允许的第一种合并方式（merge commit、squash、rebase），用 `--match-head-commit` 锁定被检查的提交；如果只是分支规则（必需检查、必需评审、分支落后）阻止合并，则用 `--admin` 重试一次。仍然无法合并的 pull request（冲突、草稿、无法绕过的 ruleset）保持打开并列在 issue 中，由求解器在其 pull request 中应用这些更新；更新落地后 Dependabot 会自行关闭它们。`--dry-run` 只列出将被合并的内容，`--no-merge-dependabot-prs` 关闭此步骤。`/task --update-all-dependencies` 遵循相同规则：

```bash
fix owner/repo --update-all-dependencies --no-merge-dependabot-prs
```
""",
    'hi': """issue **Dependabot pull requests merged before this issue was created** खंड से शुरू होता है: हर merge किया गया pull request, merge के समय पास न होने वाले checks के साथ, और एक bold निर्देश कि उन merges से आई हर build, test, lint, security और deprecation त्रुटि ठीक की जाए जब तक default branch का CI/CD फिर से हरा न हो जाए — अपडेट revert किए बिना। merge, repository द्वारा अनुमत पहली merge विधि (merge commit, squash, rebase) का उपयोग करता है, `--match-head-commit` को जाँचे गए commit पर pin करता है, और जब केवल branch नियम (required checks, required reviews, पुरानी branch) रोकते हैं तो एक बार `--admin` के साथ पुनः प्रयास करता है। जो pull requests फिर भी merge नहीं हो पाते — conflicts, drafts, बिना bypass वाले rulesets — वे खुले रहते हैं और issue में सूचीबद्ध होते हैं ताकि उनके अपडेट solver के pull request में लागू किए जाएँ; अपडेट लागू होने पर Dependabot उन्हें स्वयं बंद कर देता है। `--dry-run` केवल वही सूचीबद्ध करता है जो merge होगा, और `--no-merge-dependabot-prs` इस चरण को बंद करता है। `/task --update-all-dependencies` भी इन्हीं नियमों का पालन करता है:

```bash
fix owner/repo --update-all-dependencies --no-merge-dependabot-prs
```
""",
}

for lang in ['en', 'ru', 'zh', 'hi']:
    path = 'docs/DEPENDENCY-UPDATE-BEST-PRACTICES.md' if lang == 'en' else f'docs/DEPENDENCY-UPDATE-BEST-PRACTICES.{lang}.md'
    lines = open(path, encoding='utf-8').read().split('\n')
    start = next(i for i, l in enumerate(lines) if i > 150 and l.startswith('1. **') and 'Linguist' in l)
    i = start
    while i < len(lines) and re.match(r'^\d+\. \*\*', lines[i]):
        n = int(lines[i].split('.')[0])
        lines[i] = f'{n + 1}.' + lines[i][len(str(n)) + 1:]
        i += 1
    lines.insert(start, STEP[lang])
    # After the --no-solve code block.
    k = next(j for j in range(start, len(lines)) if lines[j] == 'fix owner/repo --update-all-dependencies --no-solve')
    end = next(j for j in range(k, len(lines)) if lines[j] == '```')
    lines[end + 1:end + 1] = [''] + PARAGRAPH[lang].rstrip('\n').split('\n')
    open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print('updated', path)
