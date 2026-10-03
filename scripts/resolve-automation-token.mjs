#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { credentialSummary, probeRepositoryCapabilities, selectAutomationToken } from './automation-token.lib.mjs';

const selection = selectAutomationToken({ appToken: process.env.RESOLVED_APP_TOKEN, token: process.env.AUTOMATION_TOKEN, defaultToken: process.env.DEFAULT_TOKEN });
if (!selection.token) throw new Error('The runner did not provide github.token');
console.log(`::add-mask::${selection.token}`);
const capabilities = await probeRepositoryCapabilities({ ...selection, administrationGranted: process.env.APP_ADMINISTRATION_GRANTED === 'true', owner: process.env.AUTOMATION_OWNER || process.env.GITHUB_REPOSITORY_OWNER });
const outputs = { token: selection.token, layer: selection.layer, 'triggers-workflows': selection.triggersWorkflows, 'can-create-repositories': capabilities.canCreateRepositories, 'can-delete-repositories': capabilities.canDeleteRepositories };
appendFileSync(
  process.env.GITHUB_OUTPUT,
  Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
);
const summary = credentialSummary(selection);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\n`);
