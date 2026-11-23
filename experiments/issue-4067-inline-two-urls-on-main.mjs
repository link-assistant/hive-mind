#!/usr/bin/env node
// Issue #4067: what the solve yargs config (used by the bot before this PR) does
// with two links in one command: `/solve <url1> <url2> --model opus`.
import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig } from '../src/solve.config.lib.mjs';
import { parseArgsWithYargs } from '../src/telegram-solve-command.lib.mjs';

const args = ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2', '--model', 'opus'];
try {
  const parsed = await parseArgsWithYargs(args, getLinoYargsFactory(), createYargsConfig);
  console.log('parsed:', JSON.stringify({ issueUrl: parsed['issue-url'] || parsed.issueUrl, _: parsed._ }));
} catch (error) {
  console.log('rejected:', error.message);
}
