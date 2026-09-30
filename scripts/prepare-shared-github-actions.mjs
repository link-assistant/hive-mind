import { appendFileSync } from 'node:fs';
import { prepareSharedActions } from './prepare-shared-github-actions.lib.mjs';

const source = await prepareSharedActions();
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Shared GitHub actions: **${source}**. Upstream: link-foundation/.github#1.\n`);
