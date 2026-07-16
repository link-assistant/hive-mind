#!/usr/bin/env node
/**
 * Issue #1843 helper: mirror the `--interactive-image-upload` solve option row
 * into the translated CONFIGURATION docs so test-docs-language-sync.mjs passes
 * (every language sibling of a changed doc must be updated in the same PR).
 *
 * Inserts the new row directly after each file's `--interactive-mode` row, then
 * prettier --write realigns the table columns. Idempotent: skips if present.
 */
import { readFileSync, writeFileSync } from 'fs';

const NEW_OPTION = '--interactive-image-upload';

const FILES = {
  'docs/CONFIGURATION.zh.md': '| `--interactive-image-upload` | | boolean | true | [实验性] 当启用 `--interactive-mode` 时，将 AI 读取/写入的图像上传到隐藏的自定义 Git refs (`refs/hive-mind-media/...`) 并在 PR 评论中内联嵌入。默认启用；使用 `--no-interactive-image-upload` 禁用。 |',
  'docs/CONFIGURATION.hi.md': '| `--interactive-image-upload` | | boolean | true | [EXPERIMENTAL] जब `--interactive-mode` चालू हो, तो AI द्वारा पढ़ी/लिखी गई images को hidden custom Git refs (`refs/hive-mind-media/...`) में upload करें और उन्हें PR comments में inline embed करें। डिफ़ॉल्ट रूप से सक्षम; अक्षम करने के लिए `--no-interactive-image-upload` उपयोग करें। |',
  'docs/CONFIGURATION.ru.md': '| `--interactive-image-upload` | | boolean | true | [ЭКСПЕРИМ.] Когда включён `--interactive-mode`, загружать изображения, которые AI читает/записывает, в скрытые пользовательские Git refs (`refs/hive-mind-media/...`) и встраивать их в комментарии к PR. Включено по умолчанию; используйте `--no-interactive-image-upload` для отключения. |',
};

for (const [file, newRow] of Object.entries(FILES)) {
  const content = readFileSync(file, 'utf8');
  if (content.includes(NEW_OPTION)) {
    console.log(`SKIP  ${file} (already contains ${NEW_OPTION})`);
    continue;
  }
  const lines = content.split('\n');
  const idx = lines.findIndex(line => line.trimStart().startsWith('| `--interactive-mode`'));
  if (idx === -1) {
    console.error(`FAIL  ${file}: could not find --interactive-mode row`);
    process.exitCode = 1;
    continue;
  }
  lines.splice(idx + 1, 0, newRow);
  writeFileSync(file, lines.join('\n'));
  console.log(`OK    ${file}: inserted ${NEW_OPTION} after line ${idx + 1}`);
}
