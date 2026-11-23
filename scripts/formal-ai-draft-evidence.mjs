#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { draftRunLinks, loadDraftOutcome, publishDraftOutcome, stageDraftEvidence } from './formal-ai-draft-evidence.lib.mjs';
import { makeDraftOutcome, withActionsEvidence } from './formal-ai-draft-outcome.lib.mjs';

const env = process.env;
const logDir = env.FORMAL_AI_DRAFT_LOG_DIR || join(env.RUNNER_TEMP || '/tmp', 'formal-ai-draft-logs');
const destination = env.FORMAL_AI_DRAFT_EVIDENCE_DIR || join(env.RUNNER_TEMP || '/tmp', 'formal-ai-draft-evidence');
const setOutput = text => {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, text);
};

const target = /^\d+$/.test(env.FORMAL_AI_DRAFT_ISSUE ?? '') ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/issues/${env.FORMAL_AI_DRAFT_ISSUE}` : null;

if (process.argv[2] === '--stage') {
  const outcome =
    (await loadDraftOutcome(logDir)) ??
    makeDraftOutcome({
      target,
      links: await draftRunLinks(),
      infrastructure: { status: 'failed', stage: 'setup', code: 'attempt_record_missing' },
    });
  const count = await stageDraftEvidence({ logDir, destination, outcome });
  setOutput(`session_logs=${count}\n`);
} else if (process.argv[2] === '--finalize') {
  const outcome = (await loadDraftOutcome(destination)) ?? (await loadDraftOutcome(logDir));
  if (!outcome) throw new Error('The draft outcome record is missing');
  const sessionLogs = /^\d+$/.test(env.FORMAL_AI_DRAFT_SESSION_LOGS ?? '') ? Number(env.FORMAL_AI_DRAFT_SESSION_LOGS) : null;
  publishDraftOutcome(withActionsEvidence(outcome, { status: env.FORMAL_AI_DRAFT_ARTIFACT_STATUS, url: env.FORMAL_AI_DRAFT_ARTIFACT_URL, sessionLogs }), setOutput, { final: true });
} else {
  throw new Error('Expected --stage or --finalize');
}
