// Check GLYPH_PROBE: true for scripts the host has fonts for, false otherwise.
// Usage: node experiments/issue-2998/glyph-probe.mjs
import { GLYPH_PROBE, loadChromium } from '../../src/github-access-animation.lib.mjs';
const browser = await (await loadChromium()).launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<body style="font:16px sans-serif">x</body>');
for (const text of ['Hello', 'Привет', '你好', 'नमस्ते', '\u{13000}\u{13001}']) console.log(JSON.stringify(text), await page.evaluate(GLYPH_PROBE, text));
await browser.close();
