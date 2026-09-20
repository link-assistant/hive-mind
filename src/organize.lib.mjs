import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runOrganizationClassifier } from './organize.ai.lib.mjs';
import { createOrganizationGitHubClient } from './organize.github.lib.mjs';
import { applyOrganizationPlan, validateOrganizationPlan, verifyOrganizationPlan } from './organize.plan.lib.mjs';
import { buildOrganizationPrompts, chunkOrganizationIssues } from './organize.prompts.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { sanitizeForPublication } from './token-sanitization.lib.mjs';

const planForAudit = plan =>
  plan.map(item => ({
    issue: item.issue,
    expectedUpdatedAt: item.expectedUpdatedAt,
    type: item.type,
    addLabels: item.addLabels,
    removeLabels: item.removeLabels,
    documentationImpact: item.documentationImpact,
    confidence: item.confidence,
    reason: item.reason,
  }));

const publicRepositoryRecord = repository => ({
  owner: repository?.owner,
  repo: repository?.repo,
  fullName: repository?.fullName,
  url: repository?.url,
  viewerPermission: repository?.viewerPermission,
});

/** Write an owner-only, content-minimized execution record. */
export async function writeOrganizationAudit(record, { stateDir = resolveBotStateDir(), now = new Date() } = {}) {
  const directory = join(stateDir, 'organize-audits');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const repository = String(record.repository?.fullName || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '-');
  const target = join(directory, `${repository}-${timestamp}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  const safeJson = await sanitizeForPublication(JSON.stringify(record, null, 2));
  await writeFile(temporary, `${safeJson}\n`, { mode: 0o600 });
  await rename(temporary, target);
  return target;
}

const baseCounts = scanned => ({ scanned, changed: 0, unchanged: scanned, stale: 0, errors: 0 });

/**
 * Collect, classify, validate, apply and verify one repository organization
 * run. The classifier receives prompts only; GitHub access stays in this layer.
 */
export async function organizeRepository({ repositoryUrl, dryRun = false, operatorInstructions = '', tool = 'claude', model = null, think = null, requestedBy = null, client = null, classifier = runOrganizationClassifier, auditWriter = writeOrganizationAudit, progress = async () => {}, maxIssuesPerChunk = 75, maxPromptCharacters = 120_000, mutationBatchSize = 10 } = {}) {
  const github = client || createOrganizationGitHubClient({ repositoryUrl });
  const startedAt = new Date().toISOString();
  let repository = { url: repositoryUrl, fullName: repositoryUrl };
  let auditPath;
  const execution = { tool, model, think };

  try {
    await progress({ stage: 'collecting', message: 'Collecting repository taxonomy and open issues' });
    repository = await github.inspectRepository();
    const { issueTypes = [], labels = [] } = await github.fetchTaxonomy();
    const issues = await github.fetchOpenIssues({ withContext: true });
    const unsupported = [];
    if (issueTypes.length === 0) unsupported.push('Repository owner exposes no enabled Issue Types; types will remain unset.');
    if (labels.length === 0) unsupported.push('Repository exposes no labels; label changes are unavailable.');

    if (issues.length === 0) {
      const publicRepository = publicRepositoryRecord(repository);
      const result = {
        repository: publicRepository,
        dryRun,
        counts: baseCounts(0),
        entries: [],
        unsupported,
        verification: { ok: true, errors: [] },
      };
      auditPath = await auditWriter({ version: 1, startedAt, completedAt: new Date().toISOString(), repository: publicRepository, dryRun, requestedBy, execution, operatorInstructionsProvided: Boolean(operatorInstructions), taxonomy: { issueTypes: issueTypes.map(type => type.name), labels: labels.map(label => label.name) }, plan: [], result });
      return { ...result, auditPath };
    }

    const chunks = chunkOrganizationIssues({ repository, issueTypes, labels, issues, maxIssues: maxIssuesPerChunk, maxCharacters: maxPromptCharacters });
    const rawItems = [];
    for (let index = 0; index < chunks.length; index++) {
      await progress({ stage: 'classifying', current: index + 1, total: chunks.length, message: `Classifying issue batch ${index + 1}/${chunks.length}` });
      const chunk = chunks[index];
      const prompts = buildOrganizationPrompts({ ...chunk, operatorInstructions, chunk: index + 1, chunkCount: chunks.length });
      const rawPlan = await classifier({ prompts, tool, model, think, chunk: index + 1, chunkCount: chunks.length });
      if (!rawPlan || !Array.isArray(rawPlan.issues)) throw new Error(`Classifier batch ${index + 1} did not return an issues array`);
      rawItems.push(...rawPlan.issues);
    }

    await progress({ stage: 'validating', message: 'Validating the complete organization plan' });
    const plan = validateOrganizationPlan({ issues: rawItems }, { issues, issueTypes, labels });
    await progress({ stage: dryRun ? 'previewing' : 'applying', message: dryRun ? 'Preparing dry-run results' : 'Applying validated metadata changes' });
    const applied = await applyOrganizationPlan({ client: github, plan, issues, dryRun, batchSize: mutationBatchSize });

    let verification;
    if (dryRun) {
      verification = { ok: true, skipped: true, errors: [] };
    } else {
      await progress({ stage: 'verifying', message: 'Verifying final GitHub metadata' });
      const finalIssues = await github.fetchOpenIssues({ withContext: false });
      verification = verifyOrganizationPlan({ plan, issues: finalIssues });
    }

    const publicRepository = publicRepositoryRecord(repository);
    const result = { repository: publicRepository, dryRun, counts: { ...applied.counts, scanned: issues.length }, entries: applied.entries, unsupported, verification };
    auditPath = await auditWriter({
      version: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      repository: publicRepository,
      dryRun,
      requestedBy,
      execution,
      operatorInstructionsProvided: Boolean(operatorInstructions),
      taxonomy: { issueTypes: issueTypes.map(type => type.name), labels: labels.map(label => label.name) },
      plan: planForAudit(plan),
      result,
    });
    await progress({ stage: 'complete', message: 'Organization run complete' });
    return { ...result, auditPath };
  } catch (error) {
    try {
      auditPath = await auditWriter({ version: 1, startedAt, completedAt: new Date().toISOString(), repository: publicRepositoryRecord(repository), dryRun, requestedBy, execution, operatorInstructionsProvided: Boolean(operatorInstructions), error: error.message });
      error.auditPath = auditPath;
    } catch {
      // Preserve the primary failure if the local audit disk is unavailable.
    }
    throw error;
  }
}

/** Build a credential-scanned Telegram/CLI summary without issue content. */
export async function formatOrganizationSummary(result) {
  const mode = result.dryRun ? 'Dry run' : result.verification.ok ? 'Organization complete' : 'Organization completed with verification errors';
  const { counts } = result;
  const lines = [`${mode}: ${result.repository.fullName}`, `Scanned ${counts.scanned}; ${result.dryRun ? 'planned' : 'changed'} ${counts.changed}; unchanged ${counts.unchanged}; stale ${counts.stale}; errors ${counts.errors}.`];
  for (const entry of result.entries) {
    if (entry.status === 'unchanged') continue;
    const detail = entry.summary || entry.message || entry.status;
    lines.push(`${entry.url || `${result.repository.url}/issues/${entry.issue}`}: ${entry.status} — ${detail}`);
  }
  for (const message of result.unsupported || []) lines.push(`Unsupported: ${message}`);
  for (const message of result.verification?.errors || []) lines.push(`Verification: ${message}`);
  return sanitizeForPublication(lines.join('\n'));
}
