// One-off helper (issue #2923): insert the new release and messaging lessons into
// every language variant of docs/CI-CD-BEST-PRACTICES*.md at the same place.
import { readFileSync, writeFileSync } from 'node:fs';

const T = {
  en: {
    s9: ['- **Wait for the registry as long as it really takes, and never republish to find out** - `npm publish` can succeed minutes before `npm view` sees the version. Hive Mind\'s lag went from 2–9 s to 99–377 s in September 2026, and 2.35.1 took 874 s (issue #2923). A 330 s window turned a good release into a red run with no GitHub release, Docker image or Helm chart. Size the window from measured data with a wide margin (`experiments/npm-publish-lag-2923.mjs` measures it from the Sigstore attestations), log how long each wait took, and treat `E409 Cannot publish over previously staged version` as "already landed", not as a failure', '- **Decide "is there anything to release?" from every artifact, not just the registry** - If the job dies after the publish, the next push sees the version on npm and skips the release for good. Check the GitHub release too and re-run the release without a bump when it is missing; a lookup that fails is "unknown", which never releases'],
    s17: ['- **Say why a job skipped.** A downstream workflow that skips because its upstream failed is correct, but a green run that silently did nothing reads as "tested". Print the reason as a `::notice::` annotation so it shows on the run summary (issue #2923).', '- **One outcome, one message.** A log that says "recovered and completed successfully" and then "❌ Agent reported error" for the same error sends readers down the wrong path. Compute the verdict first, then log only what is true.'],
  },
  ru: {
    s9: [
      '- **Ждите registry столько, сколько это реально занимает, и никогда не публикуйте повторно, чтобы проверить** — `npm publish` может завершиться успешно за несколько минут до того, как `npm view` увидит версию. В сентябре 2026 задержка Hive Mind выросла с 2–9 с до 99–377 с, а 2.35.1 появилась через 874 с (issue #2923). Окно в 330 с превратило хороший релиз в красный запуск без GitHub release, Docker-образа и Helm chart. Выбирайте окно по измеренным данным с большим запасом (`experiments/npm-publish-lag-2923.mjs` измеряет задержку по аттестациям Sigstore), пишите в лог, сколько длилось ожидание, и считайте `E409 Cannot publish over previously staged version` признаком «уже опубликовано», а не ошибкой',
      '- **Решайте «есть ли что выпускать?» по всем артефактам, а не только по registry** — если job падает после публикации, следующий push видит версию в npm и навсегда пропускает релиз. Проверяйте и GitHub release, и при его отсутствии повторяйте релиз без bump версии; неудачная проверка означает «неизвестно» и никогда не запускает релиз',
    ],
    s17: ['- **Объясняйте, почему job пропущен.** Downstream workflow, пропущенный из-за упавшего upstream, ведёт себя правильно, но зелёный запуск, который молча ничего не сделал, читается как «протестировано». Выводите причину аннотацией `::notice::`, чтобы она была видна в сводке запуска (issue #2923).', '- **Один итог — одно сообщение.** Лог, который пишет «recovered and completed successfully», а затем «❌ Agent reported error» об одной и той же ошибке, уводит читателя по ложному следу. Сначала вычислите итог, затем пишите только то, что верно.'],
  },
  zh: {
    s9: ['- **等待注册表实际需要的时间，绝不通过重新发布来确认** - `npm publish` 可能在 `npm view` 看到该版本之前几分钟就已成功。2026 年 9 月，Hive Mind 的延迟从 2–9 秒增加到 99–377 秒，2.35.1 用了 874 秒（issue #2923）。330 秒的窗口让一次成功的发布变成了红色运行，且没有 GitHub release、Docker 镜像和 Helm chart。根据实测数据并留出充足余量来设定窗口（`experiments/npm-publish-lag-2923.mjs` 通过 Sigstore 证明测量延迟），在日志中记录每次等待的时长，并把 `E409 Cannot publish over previously staged version` 视为“已经发布”，而不是失败', '- **根据所有产物而不仅是注册表来判断“是否有内容需要发布”** - 如果任务在发布之后中断，下一次推送会看到 npm 上已有该版本，从而永久跳过发布。同时检查 GitHub release，缺失时在不升级版本的情况下重新执行发布；查询失败意味着“未知”，永远不会触发发布'],
    s17: ['- **说明任务为什么被跳过。** 因上游失败而跳过的下游 workflow 是正确的，但一个静默地什么也没做的绿色运行会被理解为“已测试”。用 `::notice::` 注解输出原因，让它显示在运行摘要中（issue #2923）。', '- **一个结果，一条消息。** 日志先说 “recovered and completed successfully”，随后又针对同一个错误说 “❌ Agent reported error”，会把读者引向错误的方向。先计算最终结论，然后只记录真实的内容。'],
  },
  hi: {
    s9: [
      '- **Registry का उतना इंतज़ार करें जितना वास्तव में लगता है, और जांचने के लिए कभी दोबारा publish न करें** - `npm publish` उस समय से कई मिनट पहले सफल हो सकता है जब `npm view` version को देख पाता है। सितंबर 2026 में Hive Mind की देरी 2–9 s से बढ़कर 99–377 s हो गई, और 2.35.1 में 874 s लगे (issue #2923)। 330 s की window ने एक सफल release को लाल run बना दिया, जिसमें न GitHub release बनी, न Docker image, न Helm chart। Window को मापे गए data से बड़े margin के साथ तय करें (`experiments/npm-publish-lag-2923.mjs` Sigstore attestations से देरी मापता है), log करें कि हर इंतज़ार कितना चला, और `E409 Cannot publish over previously staged version` को failure नहीं बल्कि "पहले से publish हो चुका" मानें',
      '- **"क्या release करने को कुछ है?" का फ़ैसला हर artifact से करें, केवल registry से नहीं** - अगर job publish के बाद रुक जाता है, तो अगला push npm पर version देखता है और release को हमेशा के लिए छोड़ देता है। GitHub release भी जांचें, और उसके न होने पर बिना version bump के release दोबारा चलाएं; विफल lookup का अर्थ "अज्ञात" है, जो कभी release नहीं करता',
    ],
    s17: ['- **बताएं कि job क्यों skip हुआ।** Upstream के विफल होने पर skip होने वाला downstream workflow सही है, लेकिन चुपचाप कुछ न करने वाला हरा run "tested" जैसा पढ़ा जाता है। कारण को `::notice::` annotation के रूप में print करें ताकि वह run summary में दिखे (issue #2923)।', '- **एक परिणाम, एक संदेश।** जो log एक ही error के लिए पहले "recovered and completed successfully" और फिर "❌ Agent reported error" कहता है, वह पढ़ने वाले को गलत दिशा में भेजता है। पहले अंतिम निर्णय निकालें, फिर केवल वही log करें जो सच है।'],
  },
};

for (const [lang, text] of Object.entries(T)) {
  const file = `docs/CI-CD-BEST-PRACTICES${lang === 'en' ? '' : `.${lang}`}.md`;
  const lines = readFileSync(file, 'utf8').split('\n');
  if (lines.some(line => line.includes('npm-publish-lag-2923'))) continue;
  const s9 = lines.findIndex(line => line.startsWith('### 9.'));
  let end9 = s9 + 1;
  while (!(lines[end9].startsWith('- **') && lines[end9 + 1] === '')) end9++;
  lines.splice(end9 + 1, 0, ...text.s9);
  const s17 = lines.findIndex(line => line.startsWith('### 17.'));
  const next = lines.findIndex((line, index) => index > s17 && line.startsWith('## '));
  let end17 = next - 1;
  while (!lines[end17].startsWith('- **')) end17--;
  lines.splice(end17 + 1, 0, ...text.s17);
  writeFileSync(file, lines.join('\n'));
  console.log(`updated ${file}`);
}
