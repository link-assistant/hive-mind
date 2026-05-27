// Issue #1823: insert the --do-not-shutdown-in-the-middle-of-working-session rows into the
// localized CONFIGURATION siblings (solve table + hive table), mirroring the English doc.
// Run once; prettier --write afterwards normalizes table column alignment.
import { readFileSync, writeFileSync } from 'fs';

const OPT = 'do-not-shutdown-in-the-middle-of-working-session';

// Translated cells: [solve-table description, hive-table description]
const T = {
  ru: ['[ЭКСПЕРИМ.] При прерывании (CTRL+C / SIGTERM) не прерывать работу ИИ-инструмента посреди выполнения. Если рабочая сессия ИИ активна, дождаться её завершения, автоматически закоммитить незафиксированные изменения, затем корректно завершить работу. Если solve лишь ожидает (например, CI/CD), остановиться немедленно. Повторное прерывание принудительно останавливает. hive передаёт это автоматически каждому /solve-воркеру. См. `docs/case-studies/issue-1823/`.', '[ЭКСПЕРИМ.] При CTRL+C позволить каждому solve-воркеру завершить текущую рабочую сессию ИИ и закоммитить изменения перед остановкой (воркеры в ожидании/CI останавливаются сразу). Повторный CTRL+C принудительно останавливает. Включено по умолчанию для hive; `--no-do-not-shutdown-in-the-middle-of-working-session` для отключения.'],
  zh: ['[实验性] 收到中断（CTRL+C / SIGTERM）时不在运行中途中止 AI 工具。如果 AI 工作会话正在进行，等待其完成，自动提交所有未提交的更改，然后优雅关闭。如果 solve 只是在空闲等待（例如等待 CI/CD），则立即停止。再次中断将强制停止。hive 会自动将此传递给每个 /solve worker。参见 `docs/case-studies/issue-1823/`。', '[实验性] 收到 CTRL+C 时，让每个 solve worker 完成当前 AI 工作会话并在关闭前自动提交（空闲/等待 CI 的 worker 立即停止）。再次 CTRL+C 强制停止。hive 默认启用；`--no-do-not-shutdown-in-the-middle-of-working-session` 可禁用。'],
  hi: ['[EXPERIMENTAL] Interrupt (CTRL+C / SIGTERM) मिलने पर AI tool को बीच में abort न करें। यदि कोई AI working session चल रही है, तो उसके पूरा होने का इंतज़ार करें, सभी uncommitted changes को auto-commit करें, फिर gracefully shut down करें। यदि solve केवल idle-wait कर रहा है (जैसे CI/CD के लिए), तो तुरंत रुक जाएँ। दूसरा interrupt force-stop करता है। hive इसे हर /solve worker को अपने-आप pass करता है। देखें `docs/case-studies/issue-1823/`।', '[EXPERIMENTAL] CTRL+C पर, प्रत्येक solve worker को shut down से पहले अपनी मौजूदा AI working session पूरी करने और auto-commit करने दें (idle/CI-waiting workers तुरंत रुक जाते हैं)। दूसरा CTRL+C force-stop करता है। hive के लिए default रूप से सक्षम; disable करने के लिए `--no-do-not-shutdown-in-the-middle-of-working-session`।'],
};

for (const [lang, [solveDesc, hiveDesc]] of Object.entries(T)) {
  const path = `docs/CONFIGURATION.${lang}.md`;
  const lines = readFileSync(path, 'utf8').split('\n');
  const out = [];
  let seenAutoResume = 0;
  for (const line of lines) {
    out.push(line);
    // Solve table: insert right after the --working-session-live-progress row (appears once).
    if (line.includes('`--working-session-live-progress`') && line.trim().startsWith('|')) {
      out.push(`| \`--${OPT}\` | | boolean | false | ${solveDesc} |`);
    }
    // Hive table: insert after the SECOND --auto-resume-on-limit-reset row (the hive one).
    if (line.includes('`--auto-resume-on-limit-reset`') && line.trim().startsWith('|')) {
      seenAutoResume += 1;
      if (seenAutoResume === 2) {
        out.push(`| \`--${OPT}\` | | boolean | true | ${hiveDesc} |`);
      }
    }
  }
  writeFileSync(path, out.join('\n'));
  console.log(`Updated ${path} (auto-resume rows seen: ${seenAutoResume})`);
}
