#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { log, setLogFile, getLogFile, formatAligned, extractToolErrorCore, setupStdioLogInterceptor } from './lib.mjs';
import { parseReviewArguments } from './review.config.lib.mjs';
import { executeReviewTool } from './review.lib.mjs';

setupStdioLogInterceptor();

if (process.argv.includes('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  console.log(await getVersion());
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const { getLinoYargsFactory } = await import('./cli-arguments.lib.mjs');
  const { createYargsConfig } = await import('./review.config.lib.mjs');
  await createYargsConfig(getLinoYargsFactory()()).exitProcess(false).parse(['--help']);
  process.exit(0);
}

try {
  const argv = await parseReviewArguments();
  global.verboseMode = argv.verbose;
  const { initI18n } = await import('./i18n.lib.mjs');
  await initI18n({ language: argv.language, uiLanguage: argv.uiLanguage, workLanguage: argv.workLanguage });
  const logDir = path.resolve(argv.logDir || process.cwd());
  await fs.mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, `review-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  await fs.writeFile(logFile, '');
  setLogFile(logFile);
  await log(`📁 Log file: ${logFile}`);

  const { ensureUseM } = await import('./use-m-bootstrap.lib.mjs');
  const use = await ensureUseM();
  const { $: rawDollar } = await use('command-stream');
  const { runReview } = await import('./review.run.lib.mjs');
  const { getResourceSnapshot } = await import('./memory-check.mjs');
  const result = await runReview({ argv, $: rawDollar, log, executeTool: executeReviewTool, toolContext: { setLogFile, getLogFile, formatAligned, getResourceSnapshot } });
  if (!result.success) {
    const core = extractToolErrorCore({ toolResult: result });
    await log(`❌ Review did not complete${core ? `: ${core}` : ''}. Log: ${getLogFile()}`);
    process.exitCode = 1;
  }
} catch (error) {
  await log(`❌ Review failed: ${error.message}`, { level: 'error' });
  process.exitCode = 1;
}
