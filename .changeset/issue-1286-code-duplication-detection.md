---
'@link-assistant/hive-mind': patch
---

Add code duplication detection with jscpd

- Add .jscpd.json configuration for JavaScript code duplication detection
- Add jscpd (^4.0.5) as devDependency
- Add npm script: `npm run check:duplication`
- Integrate code duplication check into CI workflow
- Set 11% threshold baseline (current codebase level)
