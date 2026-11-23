#!/usr/bin/env node
/**
 * Issue #4053: probe the provider status pages the auth-failure retry policy consults.
 *
 * Fetches https://status.claude.com and https://status.openai.com (Atlassian
 * Statuspage v2) through the same code the retry path uses, prints the one-line
 * summary that appears in retry logs and reports, and (with --save) stores the
 * raw summary/incidents JSON as case-study evidence.
 *
 * Usage:
 *   node experiments/issue-4053-status-probe.mjs
 *   node experiments/issue-4053-status-probe.mjs --save docs/case-studies/issue-4053/data
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchProviderStatus, formatProviderStatusSummary, getProviderStatusPageUrl } from '../src/provider-status.lib.mjs';

const saveIndex = process.argv.indexOf('--save');
const saveDir = saveIndex > 0 ? process.argv[saveIndex + 1] : null;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log = async message => console.log(message);

for (const tool of ['claude', 'codex']) {
  const status = await fetchProviderStatus(tool, { enabled: true, cacheMs: 0, log });
  console.log(`${tool}: ${formatProviderStatusSummary(status)}`);
  console.log(`  hasIssues=${status.hasIssues} incidents=${(status.activeIncidents || []).length} degraded=${(status.degradedComponents || []).map(c => c.name).join(', ') || 'none'}`);
  if (!saveDir) continue;
  await mkdir(saveDir, { recursive: true });
  const pageUrl = getProviderStatusPageUrl(tool);
  for (const endpoint of ['summary', 'incidents']) {
    const response = await fetch(`${pageUrl}/api/v2/${endpoint}.json`, { signal: AbortSignal.timeout(15000) });
    const file = join(saveDir, `status-${tool}-${endpoint}-${stamp}.json`);
    await writeFile(file, `${JSON.stringify(await response.json(), null, 2)}\n`);
    console.log(`  saved ${file}`);
  }
}
