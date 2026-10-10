#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gh, ghJson } from './github-actions.lib.mjs';
import { E2E_MATRIX } from './e2e-hello-world.lib.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
const tag = (await ghJson(['release', 'view', '--repo', 'link-assistant/formal-ai', '--json', 'tagName'])).tagName;
if (!/^v?\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Unexpected Formal AI release tag: ${tag}`);
const upstream = event.workflow_run;
let shouldRun = process.env.GITHUB_EVENT_NAME !== 'workflow_run' || (upstream?.conclusion === 'success' && upstream?.head_branch === 'main');
// Issue #2923: run 37992515531 skipped after a failed release but only said
// "last successful matrix not recorded", which reads like a scheduler defect.
let reason = upstream ? `${upstream.name} run ${upstream.id} concluded ${upstream.conclusion} on ${upstream.head_branch}` : `${process.env.GITHUB_EVENT_NAME || 'manual'} event`;
let previousTag = null;
if (process.env.GITHUB_EVENT_NAME === 'schedule') {
  const runs = await ghJson(['run', 'list', '--repo', repository, '--workflow', 'e2e-hello-world-matrix.yml', '--status', 'success', '--branch', 'main', '--limit', '20', '--json', 'databaseId']);
  for (const run of runs) {
    const directory = await mkdtemp(join(tmpdir(), 'hive-e2e-metadata-'));
    try {
      // A successful prepare-only run uploads metadata without testing any model.
      // Only a completed, passing row for every required model establishes a tested tag.
      const { jobs } = await ghJson(['run', 'view', String(run.databaseId), '--repo', repository, '--json', 'jobs']);
      if (!E2E_MATRIX.every(({ tool, model }) => jobs.some(job => job.name === `${tool} / ${model}` && job.status === 'completed' && job.conclusion === 'success'))) continue;
      await gh(['run', 'download', String(run.databaseId), '--repo', repository, '--name', 'e2e-matrix-metadata', '--dir', directory]);
      previousTag = JSON.parse(readFileSync(join(directory, 'matrix.json'), 'utf8')).formalAiTag;
      break;
    } catch (error) {
      console.log(`Run ${run.databaseId} has no usable tested-tag artifact: ${error.message}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  shouldRun = previousTag !== tag;
  reason = `last fully tested Formal AI ${previousTag || 'not recorded'}`;
}
const metadataDir = process.env.E2E_METADATA_DIR || join(process.env.RUNNER_TEMP || tmpdir(), 'e2e-metadata');
mkdirSync(metadataDir, { recursive: true });
writeFileSync(join(metadataDir, 'matrix.json'), JSON.stringify({ formalAiTag: tag, previousTag, runId: process.env.GITHUB_RUN_ID, event: process.env.GITHUB_EVENT_NAME }, null, 2));
appendFileSync(process.env.GITHUB_OUTPUT, `should_run=${shouldRun}\nformal_ai_tag=${tag}\n`);
const decision = `Matrix ${shouldRun ? 'runs' : 'skips'}: latest Formal AI ${tag}; ${reason}`;
// A skipped matrix leaves a green run that tested nothing, so surface why as an annotation.
console.log(shouldRun ? decision : `::notice title=E2E matrix skipped::${decision}`);
