#!/usr/bin/env node
/**
 * RuleTester tests for hive/no-sync-in-bot-process: synchronous calls in
 * modules loaded by the Telegram bot process, the reasoned `hive-sync-ok`
 * exception and the per-file baseline.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import noSyncInBotProcess from '../eslint-rules/no-sync-in-bot-process.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const filename = join(process.cwd(), 'src/example.lib.mjs');
const baseline = { 'src/example.lib.mjs': 2 };

ruleTester.run('no-sync-in-bot-process', noSyncInBotProcess, {
  valid: [
    { code: 'await fs.promises.appendFile(path, line);', filename },
    { code: 'fs.appendFileSync(path, line); // hive-sync-ok: exit handler, the event loop is gone', filename },
    {
      code: ['// hive-sync-ok: one-time startup rotation, before polling starts', 'fs.renameSync(from, to);'].join('\n'),
      filename,
    },
    // Within the baseline: two unconverted calls are tolerated.
    { code: 'fs.statSync(a);\nfs.readFileSync(b);', filename, options: [{ baseline }] },
    // A marked call does not count against the baseline.
    { code: 'fs.statSync(a);\nfs.readFileSync(b);\nfs.writeFileSync(c, d); // hive-sync-ok: exit handler', filename, options: [{ baseline }] },
  ],
  invalid: [
    { code: 'const size = fs.statSync(path).size;', filename, errors: [{ messageId: 'violation' }] },
    { code: "execFileSync('du', ['-sb', dir]);", filename, errors: [{ messageId: 'violation' }] },
    // A marker without a reason is not an exception.
    { code: 'fs.appendFileSync(path, line); // hive-sync-ok:', filename, errors: [{ messageId: 'violation' }] },
    // The comment line above only counts when it is directly above.
    { code: '// hive-sync-ok: startup\n\nfs.renameSync(from, to);', filename, errors: [{ messageId: 'violation' }] },
    // One call over the baseline lists every unmarked call in the file.
    {
      code: 'fs.statSync(a);\nfs.readFileSync(b);\nfs.existsSync(c);',
      filename,
      options: [{ baseline }],
      errors: [
        { messageId: 'overBaseline', line: 1 },
        { messageId: 'overBaseline', line: 2 },
        { messageId: 'overBaseline', line: 3 },
      ],
    },
    // A baseline for another file does not cover this one.
    { code: 'fs.statSync(a);', filename: join(process.cwd(), 'src/other.lib.mjs'), options: [{ baseline }], errors: [{ messageId: 'violation' }] },
  ],
});
